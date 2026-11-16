// ============================================================================
// math + procedural helpers
// ============================================================================
const { sin, cos, sqrt, min, max, abs, floor, PI, pow, atan2, hypot, exp, round, tan, sign } = Math;
const TAU = PI * 2;
let _seed = 20261115;
const rnd = () => {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + (b - a) * rnd();
// each generator system starts its own random stream, so changing one (say the grass) never reshuffles another
const rseed = (n) => { _seed = (20261115 + Math.imul(n, 7919)) | 0; };
// Detail level: 0 high, 1 medium, 2 low. The same world with less in it. Remembered between visits; if the last
// load never finished (it crashed the tab), this one starts a level lower.
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
// a phone or tablet: touch controls go up, and the detail level starts on Low unless the player has picked one
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let LV = TOUCH ? 2 : 0;
try { if (localStorage.dune != null) LV = Math.min(2, Math.max(0, +localStorage.dune || 0)); if (localStorage.duneLoad && LV < 2) { LV++; keep('dune', LV); } } catch {}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const fract = (x) => x - floor(x);

const ihash = (x, y, z) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
// 2D value noise that repeats every `per` lattice cells (so the terrain tile wraps seamlessly)
const pnoise = (x, y, per, seed) => {
  const fx0 = floor(x), fy0 = floor(y);
  let fx = x - fx0, fy = y - fy0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ((fx0 % per) + per) % per, y0 = ((fy0 % per) + per) % per, x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
  return mix(mix(ihash(x0, y0, seed), ihash(x1, y0, seed), fx), mix(ihash(x0, y1, seed), ihash(x1, y1, seed), fx), fy);
};
// fractal sum of pnoise, 0..1, period `per` in units of the first octave
const pfbm = (x, y, per, oct, seed) => {
  let a = 0.5, s = 0;
  for (let i = 0; i < oct; i++) { s += a * pnoise(x, y, per, seed + i); x *= 2; y *= 2; per *= 2; a *= 0.5; }
  return s / (1 - 2 * a);
};

// float32 -> float16 bits
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
const toHalf = (v) => {
  _f32[0] = v; const x = _u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? s : s | ((m | 0x800000) >>> (14 - e));
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
};

// ---------------------------------------------------------------- 4x4 matrices (column-major Float32Array(16))
// basis + origin -> matrix
const mBasis = (o, rx, ry, rz, ux, uy, uz, fx, fy, fz, px, py, pz) => {
  o[0] = rx; o[1] = ry; o[2] = rz; o[3] = 0; o[4] = ux; o[5] = uy; o[6] = uz; o[7] = 0;
  o[8] = fx; o[9] = fy; o[10] = fz; o[11] = 0; o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
};
const mMul = (o, a, b) => {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
};
// rotation by angle a about unit axis (x,y,z) through point (px,py,pz), then translation (tx,ty,tz)
const mRot = (o, x, y, z, a, px, py, pz, tx, ty, tz) => {
  const c = cos(a), s = sin(a), t = 1 - c;
  o[0] = t * x * x + c; o[1] = t * x * y + s * z; o[2] = t * x * z - s * y; o[3] = 0;
  o[4] = t * x * y - s * z; o[5] = t * y * y + c; o[6] = t * y * z + s * x; o[7] = 0;
  o[8] = t * x * z + s * y; o[9] = t * y * z - s * x; o[10] = t * z * z + c; o[11] = 0;
  o[12] = px - (o[0] * px + o[4] * py + o[8] * pz) + tx;
  o[13] = py - (o[1] * px + o[5] * py + o[9] * pz) + ty;
  o[14] = pz - (o[2] * px + o[6] * py + o[10] * pz) + tz; o[15] = 1;
};

// ---------------------------------------------------------------- mesh builder (vertex: f32x3 pos, snorm8x4 normal + material id)
class Mesh {
  constructor() { this.p = []; this.i = []; this.aux = []; this.a = 0; }
  v(x, y, z) { this.p.push(x, y, z); this.aux.push(this.a); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // box-section sweep along a polyline; faces get their own vertices (hard edges)
  sweep(pts, w, h, upFn, caps = true) {
    const rings = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], a = pts[max(k - 1, 0)], b = pts[min(k + 1, pts.length - 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const u0 = upFn ? upFn(p, k) : abs(ty) > 0.95 ? [0, 0, 1] : [0, 1, 0];
      let sx = u0[1] * tz - u0[2] * ty, sy = u0[2] * tx - u0[0] * tz, sz = u0[0] * ty - u0[1] * tx; const sl = hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      const ux = ty * sz - tz * sy, uy = tz * sx - tx * sz, uz = tx * sy - ty * sx;
      const ww = typeof w === 'function' ? w(k) : w, hh = typeof h === 'function' ? h(k) : h;
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([e, f]) => [p[0] + sx * e * ww / 2 + ux * f * hh / 2, p[1] + sy * e * ww / 2 + uy * f * hh / 2, p[2] + sz * e * ww / 2 + uz * f * hh / 2]);
      const r = [];
      for (let s = 0; s < 4; s++) { r.push(this.v(...c[s]), this.v(...c[(s + 1) % 4])); }
      rings.push(r);
      if (caps && (k === 0 || k === pts.length - 1)) {
        const q = c.map((cc) => this.v(...cc));
        if (k === 0) this.quad(q[3], q[2], q[1], q[0]); else this.quad(q[0], q[1], q[2], q[3]);
      }
    }
    for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < 4; s++) {
      const a = rings[k][s * 2], b = rings[k][s * 2 + 1], c = rings[k + 1][s * 2 + 1], d = rings[k + 1][s * 2];
      this.quad(a, b, c, d);
    }
  }
  box(cx, cy, cz, w, h, l) { this.sweep([[cx, cy, cz - l / 2], [cx, cy, cz + l / 2]], w, h); }
  // round tube along a polyline with radius (number or function of point index), capped at both ends
  tube(pts, rad, sides = 8) {
    const rings = [];
    let ux = 0.31, uy = 0.9, uz = 0.3;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], a = pts[max(k - 1, 0)], b = pts[min(k + 1, pts.length - 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = uy * tz - uz * ty, sy = uz * tx - ux * tz, sz = ux * ty - uy * tx; const sl = hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      ux = ty * sz - tz * sy; uy = tz * sx - tx * sz; uz = tx * sy - ty * sx;
      const r = typeof rad === 'function' ? rad(k) : rad, ring = [];
      for (let s = 0; s < sides; s++) { const an = s / sides * TAU; ring.push(this.v(p[0] + (sx * cos(an) + ux * sin(an)) * r, p[1] + (sy * cos(an) + uy * sin(an)) * r, p[2] + (sz * cos(an) + uz * sin(an)) * r)); }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides; this.quad(rings[k][s], rings[k][s2], rings[k + 1][s2], rings[k + 1][s]);
    }
    const e = pts[pts.length - 1], c = this.v(e[0], e[1], e[2]), r = rings[rings.length - 1];
    for (let s = 0; s < sides; s++) this.tri(r[s], r[(s + 1) % sides], c);
    const e0 = pts[0], c0 = this.v(e0[0], e0[1], e0[2]), r0 = rings[0];
    for (let s = 0; s < sides; s++) this.tri(r0[(s + 1) % sides], r0[s], c0);
  }
  // smooth body panel: a rounded cross-section swept along a path. w = size across (the bike's x axis for a path
  // that runs along the bike), h = size the other way, p = squareness (2 is an ellipse, higher is boxier).
  // w and h can be numbers or functions of the point index. Capped at both ends.
  loft(pts, w, h, sides = 12, p = 2, up0 = [0, 1, 0]) {
    const rings = [], e = 2 / p, n = pts.length;
    for (let k = 0; k < n; k++) {
      const q = pts[k], a = pts[max(k - 1, 0)], b = pts[min(k + 1, n - 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = up0[1] * tz - up0[2] * ty, sy = up0[2] * tx - up0[0] * tz, sz = up0[0] * ty - up0[1] * tx, sl = hypot(sx, sy, sz);
      if (sl < 1e-4) { sx = 1; sy = 0; sz = 0; sl = 1; }
      sx /= sl; sy /= sl; sz /= sl;
      const ux = ty * sz - tz * sy, uy = tz * sx - tx * sz, uz = tx * sy - ty * sx;
      const ww = (typeof w === 'function' ? w(k) : w) / 2, hh = (typeof h === 'function' ? h(k) : h) / 2, ring = [];
      for (let i = 0; i < sides; i++) {
        const an = i / sides * TAU, c = cos(an), d = sin(an), cx = sign(c) * pow(abs(c), e) * ww, cy = sign(d) * pow(abs(d), e) * hh;
        ring.push(this.v(q[0] + sx * cx + ux * cy, q[1] + sy * cx + uy * cy, q[2] + sz * cx + uz * cy));
      }
      rings.push(ring);
    }
    for (let k = 0; k < n - 1; k++) for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; this.quad(rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]); }
    const e1 = pts[n - 1], c1 = this.v(e1[0], e1[1], e1[2]), r1 = rings[n - 1];
    for (let i = 0; i < sides; i++) this.tri(r1[i], r1[(i + 1) % sides], c1);
    const c0 = this.v(pts[0][0], pts[0][1], pts[0][2]), r0 = rings[0];
    for (let i = 0; i < sides; i++) this.tri(r0[(i + 1) % sides], r0[i], c0);
  }
  // closed profile [[radius, x], ...] revolved around the X axis (wheels)
  lathe(prof, seg) {
    const rings = [];
    for (let s = 0; s < seg; s++) { const an = s / seg * TAU; rings.push(prof.map(([r, x]) => this.v(x, r * cos(an), r * sin(an)))); }
    for (let s = 0; s < seg; s++) for (let k = 0; k < prof.length; k++) {
      const s2 = (s + 1) % seg, k2 = (k + 1) % prof.length; this.quad(rings[s][k], rings[s2][k], rings[s2][k2], rings[s][k2]);
    }
  }
  // sphere-ish blob: fn maps a unit direction to a point
  blob(sub, fn) {
    const t = (1 + sqrt(5)) / 2, base = this.p.length / 3;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = hypot(...v); return v.map((c) => c / l); });
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < sub; s++) {
      const cache = new Map(), F2 = [];
      const mid = (a, b) => {
        const key = a < b ? a * 65536 + b : b * 65536 + a;
        let r = cache.get(key);
        if (r === undefined) { const p = [0, 1, 2].map((k) => V[a][k] + V[b][k]); const l = hypot(...p); V.push(p.map((c) => c / l)); r = V.length - 1; cache.set(key, r); }
        return r;
      };
      for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      F = F2;
    }
    for (const v of V) { const p = fn(v[0], v[1], v[2]); this.v(p[0], p[1], p[2]); }
    for (const f of F) this.tri(base + f[0], base + f[1], base + f[2]);
  }
  // returns {vb: ArrayBuffer, ib: Uint32Array}; normals area-weighted; material id -> normal.w
  build() {
    const n = this.p.length / 3, P = this.p, I = this.i, N = new Float32Array(n * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    const vb = new ArrayBuffer(n * 16), f = new Float32Array(vb), s = new Int8Array(vb);
    for (let k = 0; k < n; k++) {
      const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2], l = hypot(nx, ny, nz) || 1;
      f[k * 4] = P[k * 3]; f[k * 4 + 1] = P[k * 3 + 1]; f[k * 4 + 2] = P[k * 3 + 2];
      s[k * 16 + 12] = round(nx / l * 127); s[k * 16 + 13] = round(ny / l * 127); s[k * 16 + 14] = round(nz / l * 127); s[k * 16 + 15] = this.aux[k];
    }
    return { vb, ib: new Uint32Array(I), nv: n, N };
  }
}
