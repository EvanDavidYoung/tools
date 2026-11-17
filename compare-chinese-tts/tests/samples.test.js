// Checks the bundled demo samples against the page that plays them.
//   node compare-chinese-tts/tests/samples.test.js
// No dependencies. Exits non-zero on the first failing group.
const fs = require("fs"), path = require("path"), assert = require("assert");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); }
};

/* sentence ids straight from the SENTENCES array in index.html */
const corpus = html.slice(html.indexOf("const SENTENCES = ["), html.indexOf("const CRITERIA"));
const sentenceIds = [...corpus.matchAll(/^\s*id:"([\w-]+)"/gm)].map(m => m[1]);

/* pull one top-level function out of the inline script by brace matching */
function extractFn(name){
  const start = html.indexOf("function " + name + "(");
  assert.ok(start >= 0, `index.html defines function ${name}()`);
  let depth = 0, i = html.indexOf("{", start);
  for (; i < html.length; i++){
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) break;
  }
  return new Function("return (" + html.slice(start, i + 1) + ")")();
}

let manifest = null;
test("samples/manifest.json exists and parses", () => {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "samples", "manifest.json"), "utf8"));
  assert.ok(Array.isArray(manifest.models) && manifest.models.length >= 2, "at least two models");
  assert.ok(manifest.samples && typeof manifest.samples === "object", "samples map");
});

test("corpus parsed from index.html", () => {
  assert.ok(sentenceIds.length >= 10, "found " + sentenceIds.length + " sentence ids");
});

test("every test sentence has at least two samples, so head-to-head works", () => {
  for (const id of sentenceIds){
    const n = (manifest.samples[id] || []).length;
    assert.ok(n >= 2, `sentence "${id}" has ${n} sample(s)`);
  }
});

test("every sample names a known model and a real, non-empty mp3", () => {
  const ids = new Set(manifest.models.map(m => m.id));
  for (const [sid, list] of Object.entries(manifest.samples)){
    for (const s of list){
      assert.ok(ids.has(s.model), `${sid}: unknown model ${s.model}`);
      assert.ok(/^samples\/[\w.-]+\.mp3$/.test(s.file), `${sid}: bad path ${s.file}`);
      const buf = fs.readFileSync(path.join(root, s.file));
      assert.ok(buf.length > 1000, `${s.file} is ${buf.length} bytes`);
      const id3 = buf.slice(0, 3).toString() === "ID3";
      const sync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
      assert.ok(id3 || sync, `${s.file} is not an mp3`);
      assert.ok(s.duration > 0.5, `${s.file} duration ${s.duration}`);
    }
  }
});

test("no orphan audio files", () => {
  const listed = new Set(Object.values(manifest.samples).flat().map(s => path.basename(s.file)));
  const extra = fs.readdirSync(path.join(root, "samples")).filter(f => f.endsWith(".mp3") && !listed.has(f));
  assert.deepStrictEqual(extra, []);
});

test("bundle stays small enough to ship", () => {
  const dir = path.join(root, "samples");
  const total = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total < 15 * 1024 * 1024, `samples/ is ${(total / 1048576).toFixed(1)} MB`);
});

test("page has a Play samples button and loads the manifest", () => {
  assert.ok(/id="samplesBtn"/.test(html), "samplesBtn in markup");
  assert.ok(html.includes('"samples/manifest.json"'), "fetches samples/manifest.json");
});

test("samplesToResults maps a manifest into playable result rows", () => {
  const samplesToResults = extractFn("samplesToResults");
  const m = {
    models: [{ id:"a/x", name:"X", price:10 }, { id:"b/y", name:"Y", price:0 }],
    samples: { sandhi: [
      { model:"a/x", voice:"v1", file:"samples/a.mp3", chars:30, ttfb:100, total:900, duration:3.2, bytes:5000, cost:0.0003 },
      { model:"b/y", voice:"",   file:"samples/b.mp3", chars:30, ttfb:200, total:1200, duration:3.0, bytes:6000, cost:0 }
    ] }
  };
  const rows = samplesToResults(m, "sandhi");
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map(r => r.pid), ["a/x", "b/y"]);
  const r = rows[0];
  assert.strictEqual(r.status, "ok");
  assert.strictEqual(r.playable, true);
  assert.strictEqual(r.url, "samples/a.mp3");
  assert.strictEqual(r.name, "X");
  assert.strictEqual(r.sample, true, "marked as a sample so the UI can say so");
  assert.strictEqual(rows[1].voice, "(default)");
  assert.deepStrictEqual(samplesToResults(m, "custom"), [], "no samples for custom text");
  assert.deepStrictEqual(samplesToResults(m, "nope"), []);
});

if (failed){ console.log(`\n${failed} failing`); process.exit(1); }
console.log("\nall passing");
