// Decodes RAW files (GPR, DNG/ProRAW, CR2/CR3, NEF, ARW, RAF, ...) with LibRaw compiled to WebAssembly.
// Returns 16-bit linear RGB in ProPhoto primaries where 65535 == sensor white.
import createRawProc from '../wasm/rawproc.js';
import { downscale } from './downscale.js';

let modulePromise = null;
const getModule = () =>
  (modulePromise ??= createRawProc({
    locateFile: (f) => new URL(`../wasm/${f}`, import.meta.url).href,
  }).then((M) => {
    warmUp(M);
    return M;
  }));

// V8 runs freshly loaded WASM in its baseline tier; a real 12 MP develop then takes ~3x longer than
// once the hot loops are optimised. Developing a small synthetic DNG up front triggers that tier-up.
function warmUp(M) {
  try {
    const dng = makeSyntheticDng(1024, 768);
    const ptr = M._malloc(dng.length);
    M.HEAPU8.set(dng, ptr);
    M._rp_process(ptr, dng.length, 0, 3, 2, 0);
    M._free(ptr);
    M._rp_free();
  } catch {}
}

/** Minimal uncompressed little-endian Bayer (RGGB) DNG with a textured test pattern. */
function makeSyntheticDng(W, H) {
  const u16 = (...v) => new Uint8Array(new Uint16Array(v).buffer);
  const u32 = (...v) => new Uint8Array(new Uint32Array(v).buffer);
  const i32 = (...v) => new Uint8Array(new Int32Array(v).buffer);
  const ascii = (s) => new TextEncoder().encode(`${s}\0`);
  const SHORT = 3, LONG = 4, BYTE = 1, ASCII = 2, RATIONAL = 5, SRATIONAL = 10;
  const dataBytes = W * H * 2;
  const entries = [
    [254, LONG, 1, u32(0)], [256, LONG, 1, u32(W)], [257, LONG, 1, u32(H)], [258, SHORT, 1, u16(16, 0)],
    [259, SHORT, 1, u16(1, 0)], [262, SHORT, 1, u16(32803, 0)], [271, ASCII, 8, ascii('Warmup!')],
    [272, ASCII, 8, ascii('Synth01')], [273, LONG, 1, null], [274, SHORT, 1, u16(1, 0)],
    [277, SHORT, 1, u16(1, 0)], [278, LONG, 1, u32(H)], [279, LONG, 1, u32(dataBytes)],
    [284, SHORT, 1, u16(1, 0)], [33421, SHORT, 2, u16(2, 2)], [33422, BYTE, 4, new Uint8Array([0, 1, 1, 2])],
    [50706, BYTE, 4, new Uint8Array([1, 4, 0, 0])], [50708, ASCII, 8, ascii('Synth01')],
    [50717, LONG, 1, u32(16383)],
    [50721, SRATIONAL, 9, i32(8, 10, -3, 10, -1, 10, -4, 10, 12, 10, 2, 10, -1, 10, 2, 10, 7, 10)],
    [50728, RATIONAL, 3, u32(1, 2, 1, 1, 3, 5)], [50778, SHORT, 1, u16(21, 0)],
  ];
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = 8 + ifdSize;
  const extraOffsets = entries.map(([, , , b]) => {
    if (!b || b.length <= 4) return 0;
    const off = extra;
    extra += b.length + (b.length & 1);
    return off;
  });
  const dataOff = extra;
  const buf = new Uint8Array(dataOff + dataBytes);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, count, bytes], i) => {
    const p = 10 + i * 12;
    dv.setUint16(p, tag, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (tag === 273) dv.setUint32(p + 8, dataOff, true);
    else if (bytes.length <= 4) buf.set(bytes, p + 8);
    else { dv.setUint32(p + 8, extraOffsets[i], true); buf.set(bytes, extraOffsets[i]); }
  });
  let seed = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const v = 2000 + 1500 * Math.sin(x * 0.05) * Math.cos(y * 0.07) + (seed >>> 22) + ((x >> 6) + (y >> 6)) % 2 * 4000;
      dv.setUint16(dataOff + (y * W + x) * 2, Math.max(0, Math.min(16383, v)), true);
    }
  }
  return buf;
}

self.onmessage = async (e) => {
  const { id, buffer, opts, warm } = e.data;
  if (warm) {
    getModule().catch(() => {});
    return;
  }
  if (e.data.selfTest) {
    // Used by scripts/smoke.mjs to check the synthetic DNG actually decodes.
    const M = await getModule();
    const dng = makeSyntheticDng(1024, 768);
    const ptr = M._malloc(dng.length);
    M.HEAPU8.set(dng, ptr);
    const rc = M._rp_process(ptr, dng.length, 0, 3, 2, 0);
    M._free(ptr);
    const res = { rc, err: rc ? M.UTF8ToString(M._rp_strerror(rc)) : '', w: M._rp_width(), h: M._rp_height() };
    M._rp_free();
    self.postMessage({ id, selfTest: res });
    return;
  }
  try {
    const t0 = performance.now();
    const M = await getModule();
    const t1 = performance.now();
    const bytes = new Uint8Array(buffer);
    const ptr = M._malloc(bytes.length);
    if (!ptr) throw new Error('Out of memory loading file');
    M.HEAPU8.set(bytes, ptr);
    const rc = M._rp_process(ptr, bytes.length, opts.half ? 1 : 0, opts.demosaic, opts.highlight, opts.wb);
    M._free(ptr);
    const timing = { wait: t1 - t0, develop: performance.now() - t1 };
    if (rc) throw new Error(`LibRaw: ${M.UTF8ToString(M._rp_strerror(rc))}`);

    const w = M._rp_width();
    const h = M._rp_height();
    const colors = M._rp_colors();
    const base = M._rp_pixels() >> 1;
    let pixels;
    if (colors === 3) {
      pixels = M.HEAPU16.slice(base, base + w * h * 3);
    } else {
      // Monochrome raws: replicate the single channel.
      pixels = new Uint16Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const v = M.HEAPU16[base + i * colors];
        pixels[i * 3] = pixels[i * 3 + 1] = pixels[i * 3 + 2] = v;
      }
    }
    const meta = JSON.parse(M.UTF8ToString(M._rp_meta()));
    meta.libraw = M.UTF8ToString(M._rp_version());
    M._rp_free();
    const preview = downscale(w, h, pixels, opts.previewMax ?? 2560);
    const transfer = preview.pixels === pixels ? [pixels.buffer] : [pixels.buffer, preview.pixels.buffer];
    self.postMessage({ id, ok: true, w, h, pixels, preview, meta, timing }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
