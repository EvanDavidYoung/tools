// Box-filter downscale of interleaved RGB16 pixels so the long side is <= maxSide.
export function downscale(w, h, px, maxSide) {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  if (f === 1) return { w, h, pixels: px };
  const nw = Math.floor(w / f);
  const nh = Math.floor(h / f);
  const out = new Uint16Array(nw * nh * 3);
  const inv = 1 / (f * f);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * w + x * f) * 3;
        for (let dx = 0; dx < f; dx++, i += 3) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
      }
      const o = (y * nw + x) * 3;
      out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv;
    }
  }
  return { w: nw, h: nh, pixels: out };
}
