/* GLSL for the visualiser.
 *  FEEDBACK pass: warps/rotates/zooms/hue-shifts the previous frame, then paints a new audio-driven
 *                 "emitter" on top  (this is the MilkDrop / WMP-Ambience trick: trails that melt into tunnels)
 *  POST pass:     mip-chain bloom, chromatic aberration, liquid wobble, tonemap, vignette, dither
 */
window.SHADERS = (function () {
  const VERT = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const COMMON = `#version 300 es
precision highp float;
precision highp sampler2D;
const float PI  = 3.14159265359;
const float TAU = 6.28318530718;
mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
vec3 hsv(float h, float s, float v){
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
vec3 pal(float t){ return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67))); }
vec3 hueRot(vec3 c, float a){
  float ca = cos(a), sa = sin(a);
  vec3 k = vec3(0.57735027);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
`;

  const FEEDBACK = COMMON + `
uniform sampler2D uPrev;
uniform sampler2D uAudio;   // 512x2: row0 = log spectrum, row1 = waveform
uniform vec2  uRes;
uniform float uTime, uPhase;
uniform float uBass, uMid, uHigh, uBeat, uEnergy, uFlux;
uniform float uZoom, uRot, uSwirl, uWarp, uDecay, uHueShift, uKaleido, uBlur;
uniform float uHue, uGain, uFlow;
uniform int   uEmitA, uEmitB;
uniform float uEmitMix;
uniform vec3  uMouse;       // xy in aspect-corrected space, z = pressed
out vec4 outColor;

float spec(float x){ return texture(uAudio, vec2(clamp(x, 0.0, 1.0), 0.25)).r; }
float wav (float x){ return texture(uAudio, vec2(clamp(x, 0.0, 1.0), 0.75)).r * 2.0 - 1.0; }

vec2 kaleido(vec2 p, float n){
  if (n < 1.5) return p;
  float r = length(p);
  float a = atan(p.y, p.x);
  float seg = TAU / n;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  return r * vec2(cos(a), sin(a));
}

// 0: pulsing waveform ring + radial spectrum spikes
vec3 emitHalo(vec2 p){
  float r = length(p);
  float u = abs(atan(p.y, p.x)) / PI;
  float base = 0.30 + 0.11 * uBass + 0.04 * uBeat;
  float d = abs(r - (base + wav(u * 0.9) * 0.20));
  float ring = exp(-d * d * 5000.0) + 0.22 * exp(-d * 16.0);
  float cell = floor(u * 40.0) / 40.0;
  float within = abs(fract(u * 40.0) - 0.5);
  float len = spec(cell * 0.92) * 0.62;
  float rr = r - (base + 0.07);
  float bar = smoothstep(0.0, 0.012, rr) * smoothstep(len + 0.012, len, rr) * smoothstep(0.5, 0.28, within);
  vec3 c = hsv(uHue + u * 0.55 + r * 0.25, 0.85, 1.0) * ring;
  c += hsv(uHue + 0.5 + cell * 0.8, 0.8, 1.0) * bar * 0.9;
  return c;
}

// 1: classic mirrored spectrum bars + scope line (the Windows Media Player "Bars and Waves" homage)
vec3 emitBars(vec2 p){
  float asp = uRes.x / uRes.y;
  float x = clamp(abs(p.x) / (asp * 0.95), 0.0, 0.999);
  float nb = 36.0;
  float cell = floor(x * nb) / nb;
  float f = fract(x * nb);
  float h = spec(cell * 0.88) * 0.95;
  float gap = smoothstep(0.08, 0.22, f) * smoothstep(0.92, 0.78, f);
  float bar = step(abs(p.y), h) * gap;
  vec3 c = hsv(uHue + cell * 0.7, 0.8, 0.55 + 0.45 * abs(p.y) / max(h, 0.05)) * bar;
  float line = exp(-pow((p.y - wav(x * 0.9) * 0.38) * 55.0, 2.0));
  c += hsv(uHue + 0.5, 0.35, 1.0) * line * 0.9;
  return c;
}

// 2: XY oscilloscope (lissajous) drawn from the waveform and a quarter-cycle-delayed copy
vec3 emitScope(vec2 p){
  p = rot(uPhase * 0.15) * p;
  float d = 1e9;
  vec2 prev = vec2(wav(0.0), wav(0.25)) * 0.75;
  for (int i = 1; i <= 40; i++){
    float t = float(i) / 40.0 * 0.5;
    vec2 cur = vec2(wav(t), wav(t + 0.25)) * 0.75;
    vec2 pa = p - prev, ba = cur - prev;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    d = min(d, length(pa - ba * h));
    prev = cur;
  }
  float g = exp(-d * d * 16000.0) + 0.22 * exp(-d * 22.0);
  return hsv(uHue + d * 1.5 + uPhase * 0.04, 0.85, 1.0) * g;
}

// 3: Julia set whose parameter orbits with the music
vec3 emitJulia(vec2 p){
  float t = uPhase * 0.09;
  vec2 c = 0.7885 * (1.0 + 0.04 * uBass) * vec2(cos(t), sin(t));
  vec2 z = rot(uPhase * 0.06) * p * 1.55;
  float it = 0.0, m2 = 0.0;
  for (int i = 0; i < 42; i++){
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    m2 = dot(z, z);
    if (m2 > 256.0) break;
    it += 1.0;
  }
  float esc = step(256.0, m2);
  float sit = it - log2(max(log2(max(m2, 1.0001)), 1e-4)) + 2.0;
  // thin glowing contour bands that crawl outward, instead of a filled region
  float v = pow(0.5 + 0.5 * sin(sit * 0.9 - uPhase * 2.2), 8.0);
  float near = smoothstep(3.0, 15.0, sit);   // only filaments close to the fractal's edge glow
  vec3 col = pal(sit * 0.05 + uHue) * v * esc * (0.8 + 0.9 * uBass) * near * 2.3;
  col += (1.0 - esc) * pal(uHue + 0.5 + length(z) * 0.15) * 0.006 * (0.5 + uMid);
  return col;
}

// 4: hyperspace hex tunnel; each ring listens to a different frequency
vec3 emitTunnel(vec2 p){
  float r = length(p) + 1e-4;
  float a = atan(p.y, p.x);
  float seg = TAU / 6.0;
  float d = r * cos(mod(a + seg * 0.5, seg) - seg * 0.5);
  // Rings live in log-polar space and scroll by uFlow, the exact outward drift the feedback applies each frame,
  // so what we paint lines up with what the loop already carried out: crisp rings at every radius, no smear.
  float z = (log(d + 0.001) - uFlow) * 2.0;
  float id = floor(z);
  float f = abs(fract(z) - 0.5);
  float line = exp(-f * f * 420.0);
  float s = spec(fract(id * 0.137) * 0.85);
  float pulse = pow(uBeat, 3.0);
  return pal(id * 0.11 + uHue) * line * (0.12 + 1.1 * s + 1.4 * pulse);
}

// 5: lava-lamp metaballs, one per frequency region
vec3 emitBlobs(vec2 p){
  float f = 0.0; vec3 col = vec3(0.0);
  for (int i = 0; i < 7; i++){
    float fi = float(i);
    float s = spec(0.04 + fi * 0.12);
    vec2 c = 0.62 * vec2(sin(uPhase * (0.30 + fi * 0.11) + fi * 1.7), cos(uPhase * (0.27 + fi * 0.07) + fi * 2.3));
    float rad = 0.07 + 0.13 * s + 0.04 * uBeat;
    float v = rad * rad / (dot(p - c, p - c) + 1e-4);
    f += v;
    col += pal(fi * 0.14 + uHue) * v;
  }
  float edge = exp(-pow((f - 1.0) * 9.0, 2.0));
  return (col / max(f, 1e-4)) * (edge * 1.3 + 0.05 * smoothstep(1.5, 4.0, f));
}

vec3 emit(int id, vec2 p){
  if (id == 0) return emitHalo(p);
  if (id == 1) return emitBars(p);
  if (id == 2) return emitScope(p);
  if (id == 3) return emitJulia(p);
  if (id == 4) return emitTunnel(p);
  return emitBlobs(p);
}

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  float r = length(p);

  // where did this pixel come from on the previous frame?
  vec2 q = rot(uRot + uSwirl * r) * p;
  q *= uZoom;
  // liquid domain warp; the value at the origin is subtracted so it never becomes a constant "wind"
  vec2 w0 = vec2(sin(uPhase * 1.3 + sin(uPhase * 0.7)), cos(-uPhase * 1.1 + cos(-uPhase * 0.5)));
  q += uWarp * (vec2(sin(q.y * 2.7 + uPhase * 1.3 + sin(q.x * 1.9 + uPhase * 0.7)),
                     cos(q.x * 2.3 - uPhase * 1.1 + cos(q.y * 2.1 - uPhase * 0.5))) - w0);
  vec2 suv = q * 0.5 * vec2(uRes.y / uRes.x, 1.0) + 0.5;

  vec3 prev = textureLod(uPrev, suv, 0.0).rgb;
  prev = mix(prev, textureLod(uPrev, suv, 1.5).rgb, uBlur);   // soft diffusion = glowy trails
  prev = max(hueRot(prev, uHueShift), 0.0) * uDecay;
  prev = max(mix(vec3(dot(prev, vec3(0.299, 0.587, 0.114))), prev, 1.02), 0.0);   // keep trails vivid, not grey

  vec2 pe = kaleido(p, uKaleido);
  vec3 e = vec3(0.0);
  if (uEmitMix < 0.999) e += (1.0 - uEmitMix) * emit(uEmitA, pe);
  if (uEmitMix > 0.001) e += uEmitMix * emit(uEmitB, pe);

  // finger-painting with the mouse
  vec2 pm = pe - kaleido(uMouse.xy, uKaleido);
  e += uMouse.z * hsv(uHue + uTime * 0.1, 0.9, 1.0) * exp(-dot(pm, pm) * 500.0);

  e *= uGain * (1.0 + 0.45 * uBeat + 0.3 * uFlux);
  e = clamp(e, 0.0, 1.6);
  float a = max(e.r, max(e.g, e.b));
  vec3 col = prev * (1.0 - 0.65 * min(a, 1.0)) + e;   // new ink partially covers old ink instead of white-out
  outColor = vec4(min(col, vec3(2.0)), 1.0);
}`;

  const POST = COMMON + `
uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uTime, uBeat, uBass, uEnergy, uAberr, uBloom, uWobble;
out vec4 outColor;

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float asp = uRes.x / uRes.y;
  float r = length(c * vec2(asp, 1.0));

  // liquid wobble that swells with the music
  float w = uWobble * (0.0006 + 0.0022 * uEnergy);
  uv += w * vec2(sin(uv.y * 24.0 + uTime * 1.7), cos(uv.x * 20.0 - uTime * 1.3));

  // chromatic aberration that kicks on the beat
  vec2 off = c * (0.0025 + 0.012 * uBeat) * uAberr * (0.3 + r);
  vec3 col;
  col.r = textureLod(uTex, uv + off, 0.0).r;
  col.g = textureLod(uTex, uv,       0.0).g;
  col.b = textureLod(uTex, uv - off, 0.0).b;

  // bloom from the mip chain, bright-pass only so blacks stay black
  vec3 b = textureLod(uTex, uv, 2.0).rgb * 0.45
         + textureLod(uTex, uv, 4.0).rgb * 0.55
         + textureLod(uTex, uv, 6.0).rgb * 0.70;
  b = max(b - 0.18, 0.0);
  col += b * uBloom * (0.7 + 0.5 * uBeat);

  col = 1.0 - exp(-col * 1.25);               // filmic-ish tonemap
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(mix(vec3(l), col, 1.3), 0.0);      // richer saturation
  col = pow(col, vec3(1.08));                  // a little more contrast
  col *= smoothstep(1.05, 0.25, r);            // vignette
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 160.0;   // dither (kills banding)
  outColor = vec4(col, 1.0);
}`;

  return { VERT, FEEDBACK, POST };
})();
