import { Renderer, INPUT, CURVE, LUT_SPACE } from './renderer.js';
import { loadLut, lutDisplayName, lutGroup, isLutFile } from './luts.js';
import { downscale } from './downscale.js';

// ---------------------------------------------------------------------------
// Settings model
// ---------------------------------------------------------------------------

const DEFAULTS = {
  demosaic: 3, highlight: 2, wbSource: 0,
  input: 'auto',
  normalize: 'auto', baseline: true,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  curve: CURVE.FILMIC,
  temp: 0, tint: 0, wbPick: [1, 1, 1], saturation: 0, vibrance: 0,
  sharpen: 0, fade: 0, grain: 0, grainSize: 1.5, vignette: 0,
  lut: '', lutMix: 1, lutSpace: LUT_SPACE.DISPLAY,
  rot: 0, flipH: false,
};
const DEFAULT_LUT_MATCH = /Kodak Portra 400 2\.png$/;
const RAW_DEVELOP_KEYS = ['demosaic', 'highlight', 'wbSource'];

const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
const SLIDERS = {
  light: [
    { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` },
    { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, fmt: pct },
    { key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01, fmt: pct },
    { key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01, fmt: pct },
    { key: 'whites', label: 'Whites', min: -1, max: 1, step: 0.01, fmt: pct },
    { key: 'blacks', label: 'Blacks', min: -1, max: 1, step: 0.01, fmt: pct },
  ],
  color: [
    { key: 'temp', label: 'Temperature', min: -1, max: 1, step: 0.01, fmt: pct, cls: 'temp' },
    { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, fmt: pct, cls: 'tint' },
    { key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01, fmt: pct },
    { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, fmt: pct },
  ],
  look: [
    { key: 'lutMix', label: 'LUT strength', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  ],
  effects: [
    { key: 'sharpen', label: 'Sharpen', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
    { key: 'fade', label: 'Fade', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
    { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
    { key: 'grainSize', label: 'Grain size', min: 1, max: 4, step: 0.1, fmt: (v) => v.toFixed(1) },
    { key: 'vignette', label: 'Vignette', min: -1, max: 1, step: 0.01, fmt: pct },
  ],
};

const SELECTS = {
  input: [['auto', 'Auto'], [INPUT.RAW, 'Camera RAW (linear)'], [INPUT.SRGB, 'sRGB (JPEG / PNG / HEIC)'],
    [INPUT.APPLE_LOG, 'Apple Log (iPhone)'], [INPUT.SLOG3, 'Sony S-Log3'], [INPUT.LOGC3, 'ARRI LogC3'],
    [INPUT.LINEAR_SRGB, 'Linear sRGB']],
  normalize: [['auto', 'Auto — RAW / linear only'], ['off', 'Off']],
  curve: [[CURVE.FILMIC, 'Filmic'], [CURVE.SOFT, 'Soft roll-off'], [CURVE.CLIP, 'Linear (hard clip)']],
  lutSpace: [[LUT_SPACE.DISPLAY, 'Display sRGB (HaldCLUT, most .cube)'], [LUT_SPACE.APPLE_LOG, 'Apple Log → Rec.709'],
    [LUT_SPACE.SLOG3, 'S-Log3 → Rec.709'], [LUT_SPACE.LOGC3, 'LogC3 → Rec.709']],
  demosaic: [[3, 'AHD'], [12, 'AAHD'], [11, 'DHT'], [4, 'DCB'], [2, 'PPG'], [1, 'VNG'], [0, 'Bilinear']],
  highlight: [[2, 'Blend'], [0, 'Clip'], [1, 'Unclip'], [5, 'Rebuild']],
  wbSource: [[0, 'As shot'], [1, 'Auto (gray world)'], [2, 'Daylight']],
};

let settings = loadSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('rawEditor.settings') || 'null');
    if (saved) return { ...DEFAULTS, ...saved };
  } catch {}
  return { ...DEFAULTS };
}
function saveSettings() {
  try { localStorage.setItem('rawEditor.settings', JSON.stringify(settings)); } catch {}
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const canvas = $('#view');
const stage = $('#stage');
const statusEl = $('#status');
const histCanvas = $('#histogram');
let renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  document.body.classList.add('fatal');
  $('#empty').innerHTML = `<h2>WebGL2 unavailable</h2><p>${err.message}</p>`;
  throw err;
}

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.classList.remove('busy', 'error');
  if (kind) statusEl.classList.add(kind);
}

// ---------------------------------------------------------------------------
// Worker (LibRaw / WASM)
// ---------------------------------------------------------------------------

let worker = null;
let jobSeq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./raw.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    e.data.ok ? job.resolve(e.data) : job.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'Decoder failed to load'));
    pending.clear();
    worker = null;
  };
  return worker;
}
function cancelDecodes() {
  if (!pending.size) return;
  worker?.terminate();
  worker = null;
  for (const job of pending.values()) job.reject(new DOMException('cancelled', 'AbortError'));
  pending.clear();
}
function decodeRaw(buffer, opts) {
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer, opts });
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const BROWSER_IMAGE = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif|tiff?)$/i;
const images = [];
let current = null;
let openToken = 0;

function addFiles(files) {
  const luts = [];
  const added = [];
  for (const file of files) {
    if (isLutFile(file.name) && /\.cube$/i.test(file.name)) { luts.push(file); continue; }
    const img = { id: crypto.randomUUID(), file, name: file.name, kind: BROWSER_IMAGE.test(file.name) ? 'image' : 'raw', thumb: null };
    images.push(img);
    added.push(img);
  }
  if (luts.length) addUserLuts(luts);
  renderFilmstrip();
  if (added.length && !current) openImage(added[0]);
  $('#empty').hidden = images.length > 0;
}

async function decodeBrowserImage(file) {
  const bmp = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { width: w, height: h } = bmp;
  bmp.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const pixels = new Uint16Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    pixels[i * 3] = rgba[j] * 257;
    pixels[i * 3 + 1] = rgba[j + 1] * 257;
    pixels[i * 3 + 2] = rgba[j + 2] * 257;
  }
  return { w, h, pixels, meta: { make: '', model: file.type || 'image', width: w, height: h } };
}

const PREVIEW_MAX = 2560;

function setPreview(img, w, h, pixels) {
  const p = downscale(w, h, pixels, PREVIEW_MAX);
  img.preview = p;
  renderer.setSource('preview', p.w, p.h, p.pixels);
  img.autoEV = computeAutoEV(img);
}

async function openImage(img, { keepView = false } = {}) {
  const token = ++openToken;
  cancelDecodes();
  current = img;
  img.fullReady = null;
  renderer.clearSource('preview');
  renderer.clearSource('full');
  if (!keepView) view.mode = 'fit';
  renderFilmstrip();
  updateInfo();
  setStatus(`Decoding ${img.name}…`, 'busy');
  const t0 = performance.now();
  let resolveFull, rejectFull;
  img.fullReady = new Promise((res, rej) => { resolveFull = res; rejectFull = rej; });
  img.fullReady.catch(() => {});
  try {
    if (img.kind === 'image') {
      const d = await decodeBrowserImage(img.file);
      if (token !== openToken) return;
      img.meta = d.meta;
      img.logical = [d.w, d.h];
      setPreview(img, d.w, d.h, d.pixels);
      renderer.setSource('full', d.w, d.h, d.pixels);
    } else {
      const buffer = await img.file.arrayBuffer();
      const opts = { demosaic: settings.demosaic, highlight: settings.highlight, wb: settings.wbSource, previewMax: PREVIEW_MAX };
      // A separate half-size pass was slower than one full develop once the WASM is warm.
      const full = await decodeRaw(buffer, { ...opts, half: false });
      if (token !== openToken) return;
      img.meta = full.meta;
      img.timing = full.timing;
      img.logical = [full.w, full.h];
      renderer.setSource('full', full.w, full.h, full.pixels);
      img.preview = full.preview;
      renderer.setSource('preview', full.preview.w, full.preview.h, full.preview.pixels);
      img.autoEV = computeAutoEV(img);
    }
    resolveFull();
    updateInfo();
    scheduleRender();
    makeThumb(img);
    const dev = img.timing ? ` (develop ${(img.timing.develop / 1000).toFixed(1)}s)` : '';
    setStatus(`${img.name} · ${img.logical[0]}×${img.logical[1]} · ${((performance.now() - t0) / 1000).toFixed(1)}s${dev}`);
  } catch (err) {
    rejectFull(err);
    if (err.name === 'AbortError' || token !== openToken) return;
    console.error(err);
    setStatus(`Could not open ${img.name}: ${err.message}${openErrorHint(img)}`, 'error');
  }
}

function openErrorHint(img) {
  if (/\.dng$/i.test(img.name)) {
    return ' — if this is iPhone ProRAW saved as JPEG-XL, switch iPhone Settings › Camera › Formats › ProRAW to “JPEG Lossless (Most Compatible)”.';
  }
  if (/\.hei[cf]$/i.test(img.name)) return ' — HEIC only decodes in Safari; shoot ProRAW or export as JPEG for other browsers.';
  return '';
}

function makeThumb(img) {
  requestAnimationFrame(() => {
    const t = document.createElement('canvas');
    const s = 120 / Math.max(canvas.width, canvas.height);
    t.width = Math.round(canvas.width * s * 1.6);
    t.height = Math.round(canvas.height * s * 1.6);
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    img.thumb = t.toDataURL('image/jpeg', 0.7);
    renderFilmstrip();
  });
}

// ---------------------------------------------------------------------------
// Colour helpers mirrored from the shader (for auto exposure + white picker)
// ---------------------------------------------------------------------------

const PROPHOTO_TO_SRGB = [
  [2.0341926, -0.7274198, -0.3067728],
  [-0.2288151, 1.2317228, -0.0029077],
  [-0.0085540, -0.1532900, 1.1618440],
];
const srgbEotf = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function effectiveInput(img = current) {
  if (settings.input !== 'auto') return Number(settings.input);
  return img?.kind === 'raw' ? INPUT.RAW : INPUT.SRGB;
}

function pixelToLinear(r, g, b, input) {
  r /= 65535; g /= 65535; b /= 65535;
  if (input === INPUT.RAW) {
    const m = PROPHOTO_TO_SRGB;
    return [m[0][0] * r + m[0][1] * g + m[0][2] * b, m[1][0] * r + m[1][1] * g + m[1][2] * b, m[2][0] * r + m[2][1] * g + m[2][2] * b];
  }
  if (input === INPUT.LINEAR_SRGB) return [r, g, b];
  return [srgbEotf(r), srgbEotf(g), srgbEotf(b)];
}

/** Exposure (stops) that puts the trimmed log-average luminance at mid grey. */
function computeAutoEV(img) {
  const { w, h, pixels } = img.preview;
  const input = effectiveInput(img);
  if (input === INPUT.APPLE_LOG || input === INPUT.SLOG3 || input === INPUT.LOGC3) return 0;
  // Luminance = dot(lumaWeights, transfer(code value)); fold the colour matrix into the weights.
  let wr = 0.2126, wg = 0.7152, wb = 0.0722;
  if (input === INPUT.RAW) {
    const m = PROPHOTO_TO_SRGB;
    [wr, wg, wb] = [0, 1, 2].map((j) => 0.2126 * m[0][j] + 0.7152 * m[1][j] + 0.0722 * m[2][j]);
  }
  const lut = new Float32Array(65536);
  for (let v = 0; v < 65536; v++) lut[v] = input === INPUT.SRGB ? srgbEotf(v / 65535) : v / 65535;
  // Histogram of log2 luminance in 1/32-stop bins over [-20, 4) stops.
  const BINS = 24 * 32;
  const hist = new Uint32Array(BINS);
  const n = w * h;
  const step = Math.max(1, Math.floor(n / 250000));
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * 3;
    const L = wr * lut[pixels[o]] + wg * lut[pixels[o + 1]] + wb * lut[pixels[o + 2]];
    const bin = Math.floor((Math.log2(Math.max(L, 1e-6)) + 20) * 32);
    hist[bin < 0 ? 0 : bin >= BINS ? BINS - 1 : bin]++;
    count++;
  }
  // Trimmed log-average: ignore the darkest 5% and brightest 3%.
  const lo = count * 0.05, hi = count * 0.97;
  let seen = 0, sum = 0, used = 0;
  for (let b = 0; b < BINS; b++) {
    const c = hist[b];
    const take = Math.max(0, Math.min(seen + c, hi) - Math.max(seen, lo));
    if (take > 0) { sum += take * ((b + 0.5) / 32 - 20); used += take; }
    seen += c;
  }
  const avg = used ? sum / used : Math.log2(0.16);
  return Math.max(-4, Math.min(4, Math.log2(0.16) - avg));
}

function wbGain() {
  const t = settings.temp * 0.75;
  const tint = settings.tint * 0.5;
  const g = [2 ** t * settings.wbPick[0], 2 ** -tint * settings.wbPick[1], 2 ** -t * settings.wbPick[2]];
  const k = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  return g.map((v) => v / k);
}

function pipelineParams(s = settings) {
  const raw = current?.kind === 'raw' && effectiveInput() === INPUT.RAW;
  let exposure = s.exposure;
  const sceneLinear = effectiveInput() === INPUT.RAW || effectiveInput() === INPUT.LINEAR_SRGB;
  if (s.normalize === 'auto' && sceneLinear) exposure += current?.autoEV ?? 0;
  else if (s.baseline && raw) exposure += current?.meta?.baselineExposure ?? 0;
  return {
    input: effectiveInput(),
    gain: s === settings ? wbGain() : [1, 1, 1],
    exposure,
    contrast: s.contrast, highlights: s.highlights, shadows: s.shadows, whites: s.whites, blacks: s.blacks,
    saturation: s.saturation, vibrance: s.vibrance,
    sharpen: s.sharpen, curve: Number(s.curve),
    fade: s.fade, grain: s.grain, grainSize: s.grainSize, vignette: s.vignette,
    lutOn: !!s.lut, lutSpace: Number(s.lutSpace), lutMix: s.lutMix,
    rot: settings.rot, flipH: settings.flipH,
  };
}

// ---------------------------------------------------------------------------
// View: fit / zoom / pan
// ---------------------------------------------------------------------------

const view = { mode: 'fit', zoom: 1, cx: 0, cy: 0 };
let showBefore = false;

function rotatedSize() {
  const [w, h] = current?.logical ?? [1, 1];
  return settings.rot % 2 ? [h, w] : [w, h];
}

function fitZoom() {
  const [w, h] = rotatedSize();
  const pad = 24 * devicePixelRatio;
  return Math.min((canvas.width - pad) / w, (canvas.height - pad) / h);
}

function viewMap() {
  const [w, h] = rotatedSize();
  if (view.mode === 'fit') {
    view.zoom = fitZoom();
    view.cx = w / 2;
    view.cy = h / 2;
  }
  const z = view.zoom;
  return [canvas.width / 2 - view.cx * z, canvas.height / 2 - view.cy * z, w * z, h * z];
}

function resizeCanvas() {
  const r = stage.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * devicePixelRatio));
  const h = Math.max(1, Math.round(r.height * devicePixelRatio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  scheduleRender();
}
new ResizeObserver(resizeCanvas).observe(stage);

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const src = renderer.sources;
  let slot = 'preview';
  if (src.full && src.preview && current?.logical) {
    const previewScale = src.preview.w / current.logical[0];
    if (view.zoom > previewScale * 1.05) slot = 'full';
  }
  if (!src[slot]) slot = src.full ? 'full' : 'preview';
  const s = showBefore ? { ...DEFAULTS, lut: '', exposure: 0, normalize: settings.normalize, baseline: settings.baseline } : settings;
  const [lw, lh] = current?.logical ?? [1, 1];
  renderer.draw({ slot, map: viewMap(), targetW: canvas.width, targetH: canvas.height, flipY: true, fullW: lw, fullH: lh, bg: bgColor() }, pipelineParams(s));
  $('#zoomLabel').textContent = view.mode === 'fit' ? `Fit · ${Math.round(view.zoom * 100 / devicePixelRatio)}%` : `${Math.round(view.zoom * 100 / devicePixelRatio)}%`;
  $('#beforeBadge').hidden = !showBefore;
  scheduleHistogram();
}

function bgColor() {
  return matchMedia('(prefers-color-scheme: light)').matches ? [0.86, 0.86, 0.87] : [0.09, 0.09, 0.1];
}

stage.addEventListener('wheel', (e) => {
  if (!current) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * devicePixelRatio;
  const my = (e.clientY - rect.top) * devicePixelRatio;
  const map = viewMap();
  const ix = (mx - map[0]) / view.zoom;
  const iy = (my - map[1]) / view.zoom;
  const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  const z = Math.min(16, Math.max(fitZoom() * 0.5, view.zoom * factor));
  view.mode = 'zoom';
  view.zoom = z;
  view.cx = ix - (mx - canvas.width / 2) / z;
  view.cy = iy - (my - canvas.height / 2) / z;
  scheduleRender();
}, { passive: false });

let drag = null;
stage.addEventListener('pointerdown', (e) => {
  if (!current) return;
  if (pickingWhite) { pickWhite(e); return; }
  if (view.mode === 'fit') return;
  drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.cx = drag.cx - ((e.clientX - drag.x) * devicePixelRatio) / view.zoom;
  view.cy = drag.cy - ((e.clientY - drag.y) * devicePixelRatio) / view.zoom;
  scheduleRender();
});
const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('dblclick', (e) => {
  if (!current || pickingWhite) return;
  if (view.mode === 'fit') zoomTo(devicePixelRatio, e); else setFit();
});

function zoomTo(z, e) {
  const map = viewMap();
  if (e) {
    const rect = canvas.getBoundingClientRect();
    view.cx = ((e.clientX - rect.left) * devicePixelRatio - map[0]) / view.zoom;
    view.cy = ((e.clientY - rect.top) * devicePixelRatio - map[1]) / view.zoom;
  }
  view.mode = 'zoom';
  view.zoom = z;
  scheduleRender();
}
function setFit() { view.mode = 'fit'; scheduleRender(); }

// ---------------------------------------------------------------------------
// White balance picker
// ---------------------------------------------------------------------------

let pickingWhite = false;
function setPicking(on) {
  pickingWhite = on;
  stage.classList.toggle('picking', on);
  $('#pickWhite').classList.toggle('active', on);
  if (on) setStatus('Click something that should be neutral grey or white…');
}

function pickWhite(e) {
  const img = current;
  if (!img?.preview) return;
  const rect = canvas.getBoundingClientRect();
  const map = viewMap();
  let u = ((e.clientX - rect.left) * devicePixelRatio - map[0]) / map[2];
  let v = ((e.clientY - rect.top) * devicePixelRatio - map[1]) / map[3];
  if (u < 0 || v < 0 || u > 1 || v > 1) return;
  if (settings.flipH) u = 1 - u;
  const r = settings.rot;
  const [su, sv] = r === 1 ? [v, 1 - u] : r === 2 ? [1 - u, 1 - v] : r === 3 ? [1 - v, u] : [u, v];
  const { w, h, pixels } = img.preview;
  const px = Math.floor(su * w);
  const py = Math.floor(sv * h);
  const input = effectiveInput();
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = py - 3; y <= py + 3; y++) {
    for (let x = px - 3; x <= px + 3; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 3;
      const c = pixelToLinear(pixels[i], pixels[i + 1], pixels[i + 2], input);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++;
    }
  }
  const c = acc.map((v) => Math.max(v / n, 1e-6));
  settings.wbPick = [c[1] / c[0], 1, c[1] / c[2]];
  settings.temp = 0;
  settings.tint = 0;
  setPicking(false);
  syncControls();
  onChange();
  setStatus('White balance set from picked point.');
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

let histTimer = 0;
function scheduleHistogram() {
  clearTimeout(histTimer);
  histTimer = setTimeout(drawHistogram, 120);
}
function drawHistogram() {
  const gl = renderer.gl;
  const w = canvas.width, h = canvas.height;
  if (!current || !renderer.sources.preview) return;
  const buf = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const map = viewMap();
  const x0 = Math.max(0, Math.floor(map[0])), x1 = Math.min(w, Math.ceil(map[0] + map[2]));
  const y0 = Math.max(0, Math.floor(h - map[1] - map[3])), y1 = Math.min(h, Math.ceil(h - map[1]));
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 250000)));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * w + x) * 4;
      bins[0][buf[i]]++; bins[1][buf[i + 1]]++; bins[2][buf[i + 2]]++;
    }
  }
  const hc = histCanvas;
  const ctx = hc.getContext('2d');
  const W = (hc.width = hc.clientWidth * devicePixelRatio);
  const H = (hc.height = hc.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, W, H);
  let max = 1;
  for (const b of bins) for (let i = 1; i < 255; i++) max = Math.max(max, b[i]);
  ctx.globalCompositeOperation = matchMedia('(prefers-color-scheme: light)').matches ? 'multiply' : 'lighter';
  const colors = ['rgba(255,70,70,0.75)', 'rgba(70,220,90,0.75)', 'rgba(80,140,255,0.75)'];
  bins.forEach((b, ci) => {
    ctx.fillStyle = colors[ci];
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - Math.min(1, Math.sqrt(b[i] / max)) * H);
    ctx.lineTo(W, H);
    ctx.fill();
  });
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
// LUT library
// ---------------------------------------------------------------------------

const lutEntries = new Map(); // id -> { id, name, group, url?, file? }
const lutCache = new Map();
let lutFilter = '';

async function loadBuiltinLuts() {
  try {
    const res = await fetch('luts.json');
    if (!res.ok) return;
    const list = await res.json();
    for (const path of list) {
      const id = `builtin:${path}`;
      lutEntries.set(id, { id, name: path, label: lutDisplayName(path), group: lutGroup(path), url: `luts/${path.split('/').map(encodeURIComponent).join('/')}` });
    }
  } catch {}
  if (!settings.lut || !lutEntries.has(settings.lut)) {
    const def = [...lutEntries.values()].find((e) => DEFAULT_LUT_MATCH.test(e.name));
    settings.lut = settings.lut && lutEntries.has(settings.lut) ? settings.lut : def?.id ?? '';
  }
  renderLutSelect();
  await applyLutSelection();
}

function addUserLuts(files) {
  let first = null;
  for (const file of files) {
    if (!isLutFile(file.name)) continue;
    const path = file.webkitRelativePath || file.name;
    const id = `user:${path}:${file.size}`;
    if (!lutEntries.has(id)) lutEntries.set(id, { id, name: path, label: lutDisplayName(path), group: `Yours · ${lutGroup(path)}`, file });
    first ??= id;
  }
  renderLutSelect();
  if (first && files.length === 1) selectLut(first);
  setStatus(`${lutEntries.size} LUTs available.`);
}

function visibleLuts() {
  const q = lutFilter.toLowerCase();
  return [...lutEntries.values()].filter((e) => !q || e.name.toLowerCase().includes(q));
}

function renderLutSelect() {
  const sel = $('#lutSelect');
  sel.innerHTML = '';
  sel.append(new Option('None', ''));
  const groups = new Map();
  for (const e of visibleLuts()) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  for (const [g, list] of groups) {
    const og = document.createElement('optgroup');
    og.label = g;
    list.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    for (const e of list) og.append(new Option(e.label, e.id));
    sel.append(og);
  }
  sel.value = lutEntries.has(settings.lut) ? settings.lut : '';
  $('#lutCount').textContent = lutEntries.size ? `${lutEntries.size} LUTs` : 'No LUTs loaded';
}

async function selectLut(id) {
  settings.lut = id;
  $('#lutSelect').value = id;
  await applyLutSelection();
  onChange();
}

let lutLoadSeq = 0;
async function applyLutSelection() {
  const id = settings.lut;
  const seq = ++lutLoadSeq;
  if (!id) { renderer.setLut(null); scheduleRender(); return; }
  const entry = lutEntries.get(id);
  if (!entry) return;
  try {
    let lut = lutCache.get(id);
    if (!lut) {
      setStatus(`Loading LUT ${entry.label}…`, 'busy');
      lut = await loadLut(entry);
      lutCache.set(id, lut);
      if (lutCache.size > 12) lutCache.delete(lutCache.keys().next().value);
      setStatus(`LUT: ${entry.label} (${lut.size}³)`);
    }
    if (seq !== lutLoadSeq) return;
    renderer.setLut(lut);
    scheduleRender();
  } catch (err) {
    setStatus(`LUT failed: ${err.message}`, 'error');
  }
}

function stepLut(dir) {
  const ids = ['', ...[...$('#lutSelect').options].map((o) => o.value).filter(Boolean)];
  const i = ids.indexOf(settings.lut);
  selectLut(ids[(i + dir + ids.length) % ids.length]);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function buildControls() {
  for (const [group, list] of Object.entries(SLIDERS)) {
    const host = document.querySelector(`[data-sliders="${group}"]`);
    for (const def of list) {
      const row = document.createElement('label');
      row.className = `slider ${def.cls ?? ''}`;
      row.innerHTML = `<span class="name">${def.label}</span><output></output>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" data-key="${def.key}">`;
      const input = row.querySelector('input');
      const out = row.querySelector('output');
      input.addEventListener('input', () => {
        settings[def.key] = parseFloat(input.value);
        out.textContent = def.fmt(settings[def.key]);
        row.classList.toggle('changed', settings[def.key] !== DEFAULTS[def.key]);
        onChange();
      });
      input.addEventListener('dblclick', () => {
        settings[def.key] = DEFAULTS[def.key];
        syncControls();
        onChange();
      });
      def.sync = () => {
        input.value = settings[def.key];
        out.textContent = def.fmt(settings[def.key]);
        row.classList.toggle('changed', settings[def.key] !== DEFAULTS[def.key]);
      };
      host.append(row);
    }
  }
  for (const [key, opts] of Object.entries(SELECTS)) {
    const sel = document.querySelector(`select[data-key="${key}"]`);
    for (const [v, label] of opts) sel.append(new Option(label, v));
    sel.addEventListener('change', () => {
      settings[key] = /^-?\d+$/.test(sel.value) ? Number(sel.value) : sel.value;
      if (RAW_DEVELOP_KEYS.includes(key)) {
        saveSettings();
        if (current?.kind === 'raw') openImage(current, { keepView: true });
        return;
      }
      if (key === 'input' && current?.preview) current.autoEV = computeAutoEV(current);
      onChange();
    });
  }
  $('#baseline').addEventListener('change', (e) => { settings.baseline = e.target.checked; onChange(); });
}

function syncControls() {
  for (const list of Object.values(SLIDERS)) for (const def of list) def.sync();
  for (const key of Object.keys(SELECTS)) document.querySelector(`select[data-key="${key}"]`).value = String(settings[key]);
  $('#baseline').checked = settings.baseline;
  $('#baseline').disabled = settings.normalize === 'auto';
  $('#lutSelect').value = lutEntries.has(settings.lut) ? settings.lut : '';
  const linearInput = current && [INPUT.RAW, INPUT.LINEAR_SRGB].includes(effectiveInput());
  const autoEv = settings.normalize === 'auto' && linearInput && current?.autoEV != null;
  $('#autoEv').textContent = autoEv ? `auto ${current.autoEV >= 0 ? '+' : ''}${current.autoEV.toFixed(2)} EV` : '';
  $('#wbReset').hidden = settings.wbPick.every((v) => v === 1) && !settings.temp && !settings.tint;
}

function onChange() {
  saveSettings();
  syncControls();
  scheduleRender();
}

function updateInfo() {
  const m = current?.meta;
  const el = $('#info');
  if (!m) { el.innerHTML = ''; return; }
  const rows = [];
  const cam = [m.make, m.model].filter(Boolean).join(' ');
  if (cam) rows.push(['Camera', cam]);
  if (m.iso) rows.push(['ISO', Math.round(m.iso)]);
  if (m.shutter) rows.push(['Shutter', m.shutter >= 1 ? `${m.shutter.toFixed(1)}s` : `1/${Math.round(1 / m.shutter)}s`]);
  if (m.aperture) rows.push(['Aperture', `ƒ/${m.aperture.toFixed(1)}`]);
  if (m.focal) rows.push(['Focal', `${m.focal.toFixed(1)}mm`]);
  if (current.logical) rows.push(['Size', `${current.logical[0]}×${current.logical[1]}`]);
  if (m.baselineExposure) rows.push(['Baseline exp.', `${m.baselineExposure > 0 ? '+' : ''}${m.baselineExposure.toFixed(2)} EV`]);
  if (current.kind === 'raw') rows.push(['Sensor', m.bayer ? 'Bayer mosaic' : 'Linear (demosaiced)']);
  el.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, '&lt;')}</dd>`).join('');
  syncControls();
}

function renderFilmstrip() {
  const strip = $('#filmstrip');
  strip.innerHTML = '';
  for (const img of images) {
    const b = document.createElement('button');
    b.className = `thumb${img === current ? ' active' : ''}`;
    b.title = img.name;
    b.innerHTML = img.thumb ? `<img alt="" src="${img.thumb}">` : `<span class="ph">${img.name.split('.').pop().toUpperCase()}</span>`;
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = img.name;
    b.append(cap);
    b.addEventListener('click', () => img !== current && openImage(img));
    strip.append(b);
  }
  $('#exportAll').disabled = images.length < 2;
  $('#export').disabled = !current;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function exportName(img, ext) {
  const base = img.name.replace(/\.[^.]+$/, '');
  const lut = lutEntries.get(settings.lut);
  const suffix = lut ? `_${lut.label.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase()}` : '_edit';
  return `${base}${suffix}.${ext}`;
}

async function renderExportBlob(img) {
  await img.fullReady;
  const fmt = $('#exportFormat').value;
  const quality = parseFloat($('#exportQuality').value);
  const longEdge = parseInt($('#exportSize').value, 10);
  const { w, h, data } = renderer.renderFull(pipelineParams());
  scheduleRender();
  let out = new OffscreenCanvas(w, h);
  out.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  if (longEdge && Math.max(w, h) > longEdge) {
    const s = longEdge / Math.max(w, h);
    const small = new OffscreenCanvas(Math.round(w * s), Math.round(h * s));
    const ctx = small.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, 0, 0, small.width, small.height);
    out = small;
  }
  const type = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
  const blob = await out.convertToBlob({ type, quality });
  return { blob, name: exportName(img, fmt === 'jpeg' ? 'jpg' : fmt) };
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function exportCurrent() {
  if (!current) return;
  try {
    setStatus('Rendering full resolution…', 'busy');
    const { blob, name } = await renderExportBlob(current);
    download(blob, name);
    setStatus(`Exported ${name} (${(blob.size / 1e6).toFixed(1)} MB)`);
  } catch (err) {
    setStatus(`Export failed: ${err.message}`, 'error');
  }
}

async function exportAll() {
  let dir = null;
  if (window.showDirectoryPicker) {
    try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (err) { if (err.name === 'AbortError') return; }
  }
  const start = current;
  let done = 0;
  for (const img of images) {
    setStatus(`Exporting ${done + 1}/${images.length}: ${img.name}…`, 'busy');
    await openImage(img, { keepView: true });
    try {
      const { blob, name } = await renderExportBlob(img);
      if (dir) {
        const fh = await dir.getFileHandle(name, { create: true });
        const ws = await fh.createWritable();
        await ws.write(blob);
        await ws.close();
      } else {
        download(blob, name);
      }
      done++;
    } catch (err) {
      console.error(err);
    }
  }
  if (start && start !== current) await openImage(start, { keepView: true });
  setStatus(`Exported ${done}/${images.length} images${dir ? ` to ${dir.name}/` : ''}.`);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function savePreset() {
  const blob = new Blob([JSON.stringify({ app: 'raw-film-editor', version: 1, settings }, null, 2)], { type: 'application/json' });
  download(blob, 'look.json');
}
async function loadPreset(file) {
  try {
    const data = JSON.parse(await file.text());
    const s = data.settings ?? data;
    const developChanged = RAW_DEVELOP_KEYS.some((k) => k in s && s[k] !== settings[k]);
    settings = { ...DEFAULTS, ...s };
    await applyLutSelection();
    onChange();
    if (developChanged && current?.kind === 'raw') openImage(current, { keepView: true });
    setStatus(`Loaded preset ${file.name}`);
  } catch (err) {
    setStatus(`Preset failed: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

buildControls();
syncControls();
loadBuiltinLuts();
getWorker().postMessage({ warm: true }); // compile the WASM while the user picks files

$('#openFiles').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
$('#lutFiles').addEventListener('change', (e) => { addUserLuts([...e.target.files]); e.target.value = ''; });
$('#lutFolder').addEventListener('change', (e) => { addUserLuts([...e.target.files]); e.target.value = ''; });
$('#presetFile').addEventListener('change', (e) => { if (e.target.files[0]) loadPreset(e.target.files[0]); e.target.value = ''; });
$('#savePreset').addEventListener('click', savePreset);
$('#lutSelect').addEventListener('change', (e) => selectLut(e.target.value));
$('#lutSearch').addEventListener('input', (e) => { lutFilter = e.target.value; renderLutSelect(); });
$('#lutPrev').addEventListener('click', () => stepLut(-1));
$('#lutNext').addEventListener('click', () => stepLut(1));
$('#export').addEventListener('click', exportCurrent);
$('#exportAll').addEventListener('click', exportAll);
$('#exportFormat').addEventListener('change', (e) => { $('#qualityRow').hidden = e.target.value === 'png'; });
$('#exportQuality').addEventListener('input', (e) => { $('#qualityOut').textContent = Math.round(e.target.value * 100); });
$('#pickWhite').addEventListener('click', () => setPicking(!pickingWhite));
$('#wbReset').addEventListener('click', () => { settings.wbPick = [1, 1, 1]; settings.temp = 0; settings.tint = 0; onChange(); });
$('#rotL').addEventListener('click', () => { settings.rot = (settings.rot + 3) % 4; onChange(); });
$('#rotR').addEventListener('click', () => { settings.rot = (settings.rot + 1) % 4; onChange(); });
$('#flipH').addEventListener('click', () => { settings.flipH = !settings.flipH; onChange(); });
$('#fit').addEventListener('click', setFit);
$('#zoom100').addEventListener('click', () => zoomTo(devicePixelRatio));
$('#resetAll').addEventListener('click', () => {
  const keep = { lut: settings.lut, demosaic: settings.demosaic, highlight: settings.highlight, wbSource: settings.wbSource };
  settings = { ...DEFAULTS, ...keep };
  onChange();
});
const before = $('#before');
before.addEventListener('pointerdown', () => { showBefore = true; scheduleRender(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) before.addEventListener(ev, () => { if (showBefore) { showBefore = false; scheduleRender(); } });

for (const ev of ['dragenter', 'dragover']) {
  window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
}
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  const files = [...e.dataTransfer.files];
  const luts = files.filter((f) => /\.cube$/i.test(f.name) || (/\.png$/i.test(f.name) && e.altKey));
  if (luts.length) addUserLuts(luts);
  addFiles(files.filter((f) => !luts.includes(f)));
});

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type="text"], input[type="search"], select, textarea')) return;
  const i = images.indexOf(current);
  if (e.key === '\\' || e.key === 'b') { if (!showBefore) { showBefore = true; scheduleRender(); } }
  else if (e.key === '[') stepLut(-1);
  else if (e.key === ']') stepLut(1);
  else if (e.key === 'f') setFit();
  else if (e.key === '1') zoomTo(devicePixelRatio);
  else if (e.key === 'w') setPicking(!pickingWhite);
  else if (e.key === 'Escape') setPicking(false);
  else if (e.key === 'ArrowRight' && i >= 0 && i < images.length - 1) openImage(images[i + 1]);
  else if (e.key === 'ArrowLeft' && i > 0) openImage(images[i - 1]);
  else if ((e.metaKey || e.ctrlKey) && e.key === 'e') { e.preventDefault(); exportCurrent(); }
});
window.addEventListener('keyup', (e) => {
  if ((e.key === '\\' || e.key === 'b') && showBefore) { showBefore = false; scheduleRender(); }
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', scheduleRender);

// Exposed for automated smoke tests.
window.__editor = { get settings() { return settings; }, images, get current() { return current; }, renderer, addFiles };
