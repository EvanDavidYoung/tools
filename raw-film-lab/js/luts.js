// LUT loading: HaldCLUT .png (RawTherapee film simulation) and Adobe/Resolve .cube 3D LUTs.
// Both are normalised to { name, size, data } where data is RGB, red-fastest, size^3 entries.

export async function parseHaldImage(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bmp;
  const level = Math.round(Math.cbrt(width));
  if (width !== height || level ** 3 !== width) {
    bmp.close();
    throw new Error(`Not a HaldCLUT image (${width}×${height}); expected a square of side level³`);
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const size = level * level;
  const n = size ** 3;
  // Hald pixel index i = r + g*size + b*size*size, which is exactly 3D-texture order.
  const data = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    data[i * 3] = rgba[j];
    data[i * 3 + 1] = rgba[j + 1];
    data[i * 3 + 2] = rgba[j + 2];
  }
  return { size, data, type: 'u8' };
}

export function parseCube(text) {
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
    else if (key === 'LUT_1D_SIZE') throw new Error('1D .cube LUTs are not supported');
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(key)) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || vals.length !== size ** 3 * 3) throw new Error('Malformed .cube file');
  const data = new Float32Array(vals);
  // Domain remapping is applied in the shader via uLutDomain; store it with the LUT.
  return { size, data, type: 'f32', domain: [min, max] };
}

export async function loadLut(entry) {
  const blob = entry.file ?? (await fetch(entry.url).then((r) => {
    if (!r.ok) throw new Error(`Could not fetch LUT ${entry.url}`);
    return r.blob();
  }));
  const lut = /\.cube$/i.test(entry.name) ? parseCube(await blob.text()) : await parseHaldImage(blob);
  return { ...lut, name: entry.name };
}

export function lutDisplayName(path) {
  return path.replace(/\.(png|cube)$/i, '').split('/').pop();
}

export function lutGroup(path) {
  const parts = path.split('/');
  parts.pop();
  return parts.slice(-2).join(' / ') || 'LUTs';
}

export function isLutFile(name) {
  return /\.(png|cube)$/i.test(name);
}
