// WebGL2 renderer: the whole edit pipeline runs in one fragment shader so sliders are real time.
// Source textures are RGB16UI (linear, scene-referred); output is display sRGB.

export const INPUT = { RAW: 0, SRGB: 1, APPLE_LOG: 2, SLOG3: 3, LOGC3: 4, LINEAR_SRGB: 5 };
export const CURVE = { CLIP: 0, FILMIC: 1, SOFT: 2 };
export const LUT_SPACE = { DISPLAY: 0, APPLE_LOG: 2, SLOG3: 3, LOGC3: 4 };

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler3D;

uniform usampler2D uSrc;
uniform ivec2 uSrcSize;
uniform vec2 uFullSize;     // full-resolution source size, for resolution-independent grain
uniform vec4 uMap;          // image uv = (frag - uMap.xy) / uMap.zw   (in rotated image space)
uniform float uFlipY;       // 1 for on-screen canvas, 0 for export framebuffer
uniform float uCanvasH;
uniform int uRot;           // clockwise quarter turns
uniform int uFlipH;
uniform vec3 uBg;

uniform int uInput;
uniform vec3 uGain;         // white balance gains (linear sRGB)
uniform float uExposure;    // stops
uniform float uContrast, uHighlights, uShadows, uWhites, uBlacks;
uniform float uSaturation, uVibrance;
uniform float uSharpen;
uniform int uCurve;
uniform float uFade, uGrain, uGrainSize, uVignette;

uniform int uLutOn;
uniform int uLutSpace;
uniform float uLutMix;
uniform float uLutSize;
uniform vec3 uLutMin, uLutMax;
uniform sampler3D uLut;

out vec4 outColor;

const mat3 PROPHOTO_TO_SRGB = mat3(
   2.0341926, -0.2288151, -0.0085540,
  -0.7274198,  1.2317228, -0.1532900,
  -0.3067728, -0.0029077,  1.1618440);
const mat3 REC2020_TO_SRGB = mat3(
   1.6604910, -0.1245505, -0.0181508,
  -0.5876411,  1.1328999, -0.1005789,
  -0.0728499, -0.0083494,  1.1187297);
const mat3 SRGB_TO_REC2020 = mat3(
  0.6274039, 0.0690973, 0.0163914,
  0.3292830, 0.9195404, 0.0880133,
  0.0433131, 0.0113623, 0.8955953);
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float srgbEotf(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float srgbOetf(float v) { v = clamp(v, 0.0, 1.0); return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }

// Apple Log (Apple Log Profile white paper)
const float AL_R0 = -0.05641088, AL_RT = 0.01, AL_C = 47.28711236, AL_B = 0.00964052, AL_G = 0.08550479, AL_D = 0.69336945;
float appleLogDecode(float p) {
  float pt = AL_C * (AL_RT - AL_R0) * (AL_RT - AL_R0);
  if (p < 0.0) return AL_R0;
  if (p <= pt) return sqrt(p / AL_C) + AL_R0;
  return exp2((p - AL_D) / AL_G) - AL_B;
}
float appleLogEncode(float r) {
  if (r < AL_R0) return 0.0;
  if (r <= AL_RT) return AL_C * (r - AL_R0) * (r - AL_R0);
  return AL_G * log2(r + AL_B) + AL_D;
}
// Sony S-Log3
float slog3Decode(float x) {
  return x >= 171.2102946929 / 1023.0
    ? pow(10.0, (x * 1023.0 - 420.0) / 261.5) * 0.19 - 0.01
    : (x * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0);
}
float slog3Encode(float l) {
  return l >= 0.01125
    ? (420.0 + log(max((l + 0.01) / 0.19, 1e-6)) / log(10.0) * 261.5) / 1023.0
    : (l * (171.2102946929 - 95.0) / 0.01125 + 95.0) / 1023.0;
}
// ARRI LogC3 (EI 800)
const float LC_CUT = 0.010591, LC_A = 5.555556, LC_B = 0.052272, LC_C = 0.247190, LC_D = 0.385537, LC_E = 5.367655, LC_F = 0.092809;
float logc3Decode(float t) {
  return t > LC_E * LC_CUT + LC_F ? (pow(10.0, (t - LC_D) / LC_C) - LC_B) / LC_A : (t - LC_F) / LC_E;
}
float logc3Encode(float x) {
  return x > LC_CUT ? LC_C * log(LC_A * x + LC_B) / log(10.0) + LC_D : LC_E * x + LC_F;
}

vec3 fetchSrc(ivec2 p) {
  p = clamp(p, ivec2(0), uSrcSize - 1);
  return vec3(texelFetch(uSrc, p, 0).rgb) / 65535.0;
}

// Bilinear fetch in source pixel space.
vec3 sampleSrc(vec2 px) {
  vec2 f = px - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  vec3 a = fetchSrc(i), b = fetchSrc(i + ivec2(1, 0));
  vec3 c = fetchSrc(i + ivec2(0, 1)), d = fetchSrc(i + ivec2(1, 1));
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

vec3 toLinear(vec3 c) {
  if (uInput == 0) return PROPHOTO_TO_SRGB * c;
  if (uInput == 1) return vec3(srgbEotf(c.r), srgbEotf(c.g), srgbEotf(c.b));
  if (uInput == 2) return REC2020_TO_SRGB * vec3(appleLogDecode(c.r), appleLogDecode(c.g), appleLogDecode(c.b));
  if (uInput == 3) return vec3(slog3Decode(c.r), slog3Decode(c.g), slog3Decode(c.b));
  if (uInput == 4) return vec3(logc3Decode(c.r), logc3Decode(c.g), logc3Decode(c.b));
  return c;
}

vec3 logEncode(vec3 lin, int space) {
  if (space == 2) { vec3 r = SRGB_TO_REC2020 * lin; return vec3(appleLogEncode(r.r), appleLogEncode(r.g), appleLogEncode(r.b)); }
  if (space == 3) return vec3(slog3Encode(lin.r), slog3Encode(lin.g), slog3Encode(lin.b));
  return vec3(logc3Encode(lin.r), logc3Encode(lin.g), logc3Encode(lin.b));
}

vec3 acesFilm(vec3 x) {
  x *= 0.8;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 baseCurve(vec3 x) {
  x = max(x, 0.0);
  if (uCurve == 1) return acesFilm(x);
  if (uCurve == 2) { const float W = 6.0; return clamp(x * (1.0 + x / (W * W)) / (1.0 + x), 0.0, 1.0); }
  return clamp(x, 0.0, 1.0);
}

vec3 applyLut(vec3 c) {
  vec3 uvw = clamp((c - uLutMin) / (uLutMax - uLutMin), 0.0, 1.0);
  uvw = uvw * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
  return texture(uLut, uvw).rgb;
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uFlipY > 0.5 ? uCanvasH - gl_FragCoord.y : gl_FragCoord.y);
  vec2 uv = (frag - uMap.xy) / uMap.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { outColor = vec4(uBg, 1.0); return; }

  vec2 iuv = uv;                       // uv in rotated image, kept for vignette
  if (uFlipH == 1) uv.x = 1.0 - uv.x;
  vec2 s;
  if (uRot == 1) s = vec2(uv.y, 1.0 - uv.x);
  else if (uRot == 2) s = vec2(1.0 - uv.x, 1.0 - uv.y);
  else if (uRot == 3) s = vec2(1.0 - uv.y, uv.x);
  else s = uv;

  vec2 px = s * vec2(uSrcSize);
  vec3 c = toLinear(sampleSrc(px));

  if (uSharpen > 0.0) {
    ivec2 ip = ivec2(px);
    vec3 n = toLinear(fetchSrc(ip + ivec2(1, 0))) + toLinear(fetchSrc(ip - ivec2(1, 0)))
           + toLinear(fetchSrc(ip + ivec2(0, 1))) + toLinear(fetchSrc(ip - ivec2(0, 1)));
    c = max(c + uSharpen * 1.5 * (c - n * 0.25), 0.0);
  }

  // White balance + exposure
  c *= uGain * exp2(uExposure);

  // Tone: contrast + zonal adjustments as luminance-ratio gains (hue preserving)
  float L = max(dot(c, LUMA), 1e-6);
  float e = log2(L / 0.18);
  float stops = uContrast * e;
  stops += uShadows * 1.6 * (1.0 - smoothstep(-5.0, 0.5, e));
  stops += uHighlights * 1.6 * smoothstep(-0.5, 3.0, e);
  stops += uWhites * 1.0 * smoothstep(1.5, 4.0, e);
  stops += uBlacks * 1.0 * (1.0 - smoothstep(-8.0, -2.5, e));
  c *= exp2(stops);

  // Saturation / vibrance
  L = dot(c, LUMA);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = mx > 1e-6 ? (mx - mn) / mx : 0.0;
  float satAmt = 1.0 + uSaturation + uVibrance * (1.0 - sat);
  c = max(mix(vec3(L), c, satAmt), 0.0);

  // Display transform (optionally through a LUT)
  vec3 disp = baseCurve(c);
  disp = vec3(srgbOetf(disp.r), srgbOetf(disp.g), srgbOetf(disp.b));
  if (uLutOn == 1) {
    vec3 looked = uLutSpace == 0 ? applyLut(disp) : applyLut(logEncode(c, uLutSpace));
    disp = mix(disp, looked, uLutMix);
  }

  // Finishing
  disp = uFade * 0.12 + disp * (1.0 - uFade * 0.12);
  if (uVignette != 0.0) {
    vec2 d = (iuv - 0.5) * 2.0;
    float r = length(d) / 1.41421;
    disp *= 1.0 + uVignette * 0.85 * smoothstep(0.35, 1.0, r);
  }
  if (uGrain > 0.0) {
    vec2 g = floor(s * uFullSize / uGrainSize);
    float n = (hash(g) + hash(g + 17.31) + hash(g + 41.7)) / 3.0 - 0.5;
    float ld = dot(disp, LUMA);
    disp += n * uGrain * 0.35 * (1.0 - abs(ld - 0.5) * 1.4);
  }
  outColor = vec4(clamp(disp, 0.0, 1.0), 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.prog = this.#program(VS, FS);
    this.loc = {};
    const n = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const { name } = gl.getActiveUniform(this.prog, i);
      this.loc[name] = gl.getUniformLocation(this.prog, name);
    }
    // Uniforms the compiler optimises away resolve to null, which WebGL accepts as a no-op.
    this.loc = new Proxy(this.loc, { get: (t, k) => t[k] ?? null });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.sources = {};
    this.lutTex = gl.createTexture();
    this.lut = null;
    this.#uploadLut({ size: 2, data: new Uint8Array(24), type: 'u8' });
    this.lut = null;
  }

  #program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /** Upload RGB16 pixels under a slot name ('preview' | 'full'). */
  setSource(slot, w, h, pixels) {
    const gl = this.gl;
    if (w > this.maxTex || h > this.maxTex) throw new Error(`Image ${w}×${h} exceeds GPU texture limit ${this.maxTex}`);
    let src = this.sources[slot];
    if (!src) src = this.sources[slot] = { tex: gl.createTexture() };
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16UI, w, h, 0, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    src.w = w;
    src.h = h;
  }

  clearSource(slot) {
    const src = this.sources[slot];
    if (src) {
      this.gl.deleteTexture(src.tex);
      delete this.sources[slot];
    }
  }

  setLut(lut) {
    if (!lut) {
      this.lut = null;
      return;
    }
    this.#uploadLut(lut);
    this.lut = lut;
  }

  #uploadLut(lut) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (lut.type === 'f32') gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    else gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /**
   * Draw. `view` = { slot, map:[ox,oy,sx,sy], targetW, targetH, flipY, fullW, fullH }
   * `p` = resolved pipeline params (see app.js#pipelineParams).
   */
  draw(view, p, framebuffer = null) {
    const gl = this.gl;
    const src = this.sources[view.slot];
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, view.targetW, view.targetH);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const L = this.loc;
    const bg = view.bg ?? [0.11, 0.11, 0.12];
    if (!src) {
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(L.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.uniform1i(L.uLut, 1);

    gl.uniform2i(L.uSrcSize, src.w, src.h);
    gl.uniform2f(L.uFullSize, view.fullW ?? src.w, view.fullH ?? src.h);
    gl.uniform4f(L.uMap, ...view.map);
    gl.uniform1f(L.uFlipY, view.flipY ? 1 : 0);
    gl.uniform1f(L.uCanvasH, view.targetH);
    gl.uniform1i(L.uRot, p.rot);
    gl.uniform1i(L.uFlipH, p.flipH ? 1 : 0);
    gl.uniform3f(L.uBg, ...bg);

    gl.uniform1i(L.uInput, p.input);
    gl.uniform3f(L.uGain, ...p.gain);
    gl.uniform1f(L.uExposure, p.exposure);
    gl.uniform1f(L.uContrast, p.contrast);
    gl.uniform1f(L.uHighlights, p.highlights);
    gl.uniform1f(L.uShadows, p.shadows);
    gl.uniform1f(L.uWhites, p.whites);
    gl.uniform1f(L.uBlacks, p.blacks);
    gl.uniform1f(L.uSaturation, p.saturation);
    gl.uniform1f(L.uVibrance, p.vibrance);
    gl.uniform1f(L.uSharpen, p.sharpen);
    gl.uniform1i(L.uCurve, p.curve);
    gl.uniform1f(L.uFade, p.fade);
    gl.uniform1f(L.uGrain, p.grain);
    gl.uniform1f(L.uGrainSize, p.grainSize);
    gl.uniform1f(L.uVignette, p.vignette);

    const lut = p.lutOn ? this.lut : null;
    gl.uniform1i(L.uLutOn, lut ? 1 : 0);
    gl.uniform1i(L.uLutSpace, p.lutSpace);
    gl.uniform1f(L.uLutMix, p.lutMix);
    gl.uniform1f(L.uLutSize, lut ? lut.size : 2);
    const dom = lut?.domain ?? [[0, 0, 0], [1, 1, 1]];
    gl.uniform3f(L.uLutMin, ...dom[0]);
    gl.uniform3f(L.uLutMax, ...dom[1]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Render the full-resolution source to an RGBA8 buffer (top row first). */
  renderFull(p) {
    const gl = this.gl;
    const src = this.sources.full;
    if (!src) throw new Error('Full-resolution image not decoded yet');
    const rotated = p.rot % 2 === 1;
    const w = rotated ? src.h : src.w;
    const h = rotated ? src.w : src.h;
    const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    if (w > maxRb || h > maxRb) throw new Error(`Export size ${w}×${h} exceeds GPU limit ${maxRb}`);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.draw({ slot: 'full', map: [0, 0, w, h], targetW: w, targetH: h, flipY: false }, p, fb);
    const out = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return { w, h, data: out };
  }
}
