#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""
Pre-record the demo samples that index.html plays when a visitor has no key.

One clip per test sentence per model, written to samples/ as mp3, plus
samples/manifest.json describing them. Sentences are read straight out of
index.html so the two can't drift apart. Re-running skips clips that already
exist, so a flaky model can be retried cheaply; pass --force to redo everything.

    OPENROUTER_API_KEY=sk-or-... uv run scripts/make_samples.py
    uv run scripts/make_samples.py --key-file ~/.config/openrouter-key

Needs ffmpeg/ffprobe on PATH (engines that return PCM or WAV get transcoded).
Costs a few cents: ~13 sentences x ~50 characters x 5 models.
"""
import argparse, json, os, re, subprocess, sys, tempfile, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples"
OR = "https://openrouter.ai/api/v1"

# Mirrors DEFAULT_PICKS / DEFAULT_VOICE / DEFAULT_OPTS in index.html.
MODELS = [
    ("minimax/speech-2.8-hd", "Chinese (Mandarin)_News_Anchor"),
    ("qwen/qwen-audio-3.0-tts-flash", "loongjohn"),
    ("fish-audio/s2.1-pro-free:free", None),          # None = first advertised voice, else none
    ("google/gemini-3.1-flash-tts-preview", "Kore"),
    ("hexgrad/kokoro-82m", "zf_xiaoxiao"),
]
PROVIDER_TAG = {"minimax/": "minimax", "qwen/": "alibaba", "google/": "google-vertex"}


def opts_for(model, sentence_id):
    if model.startswith("minimax/"):
        # Cantonese sentence: ask MiniMax for Cantonese, as the page's notes advise.
        return {"language_boost": "Chinese,Yue" if sentence_id == "yue" else "Chinese"}
    return None


def sentences():
    html = (ROOT / "index.html").read_text("utf8")
    block = html[html.index("const SENTENCES = ["):html.index("const CRITERIA")]
    found = re.findall(r'id:"([\w-]+)".*?zh:"([^"]+)"', block, re.S)
    if len(found) < 10:
        sys.exit(f"parsed only {len(found)} sentences from index.html")
    return found


def slug(s):
    return re.sub(r"[^\w.-]+", "_", s).strip("_")


def catalogue():
    with urlopen(OR + "/models?output_modalities=speech", timeout=60) as r:
        data = json.load(r)["data"]
    return {m["id"]: m for m in data}


def synth(key, model, voice, text, opts, fmt):
    body = {"model": model, "input": text, "response_format": fmt}
    if voice:
        body["voice"] = voice
    if opts:
        tag = next((v for k, v in PROVIDER_TAG.items() if model.startswith(k)), model.split("/")[0])
        body["provider"] = {"options": {tag: opts}}
    req = Request(OR + "/audio/speech", data=json.dumps(body).encode(), method="POST",
                  headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urlopen(req, timeout=180) as r:
        ttfb = (time.perf_counter() - t0) * 1000
        ctype = r.headers.get("Content-Type", "").lower()
        buf = r.read()
    total = (time.perf_counter() - t0) * 1000
    if "json" in ctype or not buf:
        raise RuntimeError("no audio in reply: " + buf[:200].decode("utf8", "replace"))
    return buf, ctype, ttfb, total


def is_mp3(b):
    return b[:3] == b"ID3" or (len(b) > 1 and b[0] == 0xFF and (b[1] & 0xE0) == 0xE0)


def to_mp3(buf, ctype, dest):
    """Write buf to dest as mp3. Framed mp3 is kept as-is; anything else is transcoded."""
    if is_mp3(buf):
        dest.write_bytes(buf)
        return
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(buf)
    try:
        framed = buf[:4] in (b"RIFF", b"OggS", b"fLaC")
        rate = (re.search(r"rate=(\d+)", ctype) or [None, "24000"])[1]
        src = ["-i", tmp.name] if framed else ["-f", "s16le", "-ar", rate, "-ac", "1", "-i", tmp.name]
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *src, "-codec:a", "libmp3lame",
                        "-b:a", "64k", str(dest)], check=True)
    finally:
        os.unlink(tmp.name)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    return round(float(out.stdout.strip()), 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key-file")
    ap.add_argument("--force", action="store_true", help="re-record clips that already exist")
    ap.add_argument("--only", help="comma-separated sentence ids")
    a = ap.parse_args()
    key = (Path(a.key_file).expanduser().read_text().strip() if a.key_file
           else os.environ.get("OPENROUTER_API_KEY", "").strip())
    if not key:
        sys.exit("set OPENROUTER_API_KEY or pass --key-file")

    OUT.mkdir(exist_ok=True)
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {"samples": {}}
    cat = catalogue()

    models = []
    for mid, voice in MODELS:
        m = cat.get(mid)
        if not m:
            print(f"skip {mid}: not in the OpenRouter catalogue any more")
            continue
        advertised = [str(v) for v in m.get("supported_voices") or []]
        if voice is None:
            voice = advertised[0] if advertised else ""
        models.append({"id": mid, "name": m.get("name") or mid, "voice": voice,
                       "price": round(float((m.get("pricing") or {}).get("prompt") or 0) * 1e6, 4)})
    manifest["models"] = models

    only = set(a.only.split(",")) if a.only else None
    failures = []
    for sid, text in sentences():
        if only and sid not in only:
            continue
        have = {s["model"]: s for s in manifest["samples"].get(sid, [])}
        rows = []
        for m in models:
            dest = OUT / f"{sid}--{slug(m['id'])}.mp3"
            old = have.get(m["id"])
            if old and dest.exists() and not a.force:
                rows.append(old)
                continue
            opts = opts_for(m["id"], sid)
            fmt = "pcm" if m["id"].startswith("google/gemini") else "mp3"
            try:
                try:
                    buf, ctype, ttfb, total = synth(key, m["id"], m["voice"], text, opts, fmt)
                except HTTPError as e:
                    msg = e.read().decode("utf8", "replace")
                    if e.code == 400 and "response_format" in msg:
                        fmt = "pcm" if fmt == "mp3" else "mp3"
                        buf, ctype, ttfb, total = synth(key, m["id"], m["voice"], text, opts, fmt)
                    else:
                        raise RuntimeError(f"HTTP {e.code}: {msg[:200]}")
                to_mp3(buf, ctype, dest)
            except Exception as e:  # keep going; one bad model shouldn't sink the batch
                failures.append(f"{sid} / {m['id']}: {e}")
                print(f"FAIL {sid:10} {m['id']}: {e}")
                continue
            row = {"model": m["id"], "voice": m["voice"], "file": f"samples/{dest.name}",
                   "chars": len(text), "ttfb": round(ttfb, 1), "total": round(total, 1),
                   "duration": duration(dest), "bytes": len(buf),
                   "cost": round(len(text) / 1e6 * m["price"], 6)}
            if opts:
                row["options"] = opts
            rows.append(row)
            print(f"ok   {sid:10} {m['id']:40} {row['duration']:5.1f}s  {row['total']:7.0f} ms")
        manifest["samples"][sid] = rows

    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", "utf8")
    print(f"\nwrote {mpath.relative_to(ROOT)}")
    if failures:
        print(f"{len(failures)} clip(s) failed. Re-run to retry just those:")
        for f in failures:
            print("  " + f)


if __name__ == "__main__":
    main()
