// ============================================================================
// the dune field: one 2048 m square of sand, 1 m per sample, that repeats forever in every direction.
// Built once on the CPU so the physics and the picture use exactly the same ground.
// ============================================================================
const TN = 2048, TM = TN - 1, TILE = TN, HN = 1024, HM = HN - 1;
const SAND = [0.5, 0.325, 0.175]; // linear albedo of the sand
// The sun travels in one vertical plane: it comes up over the (SDX, SDZ) side at 06:00, is overhead at noon and
// goes down on the opposite side at 18:00. That lets two baked skyline maps give the dune shadows for any hour.
const SDX = -0.5, SDZ = 0.866, SUN = [0, 1, 0];
let SUN_TAN = 9, SUN_SIDE = 0; // slope of the sun above the horizon (-1 at night), and which skyline map faces it
function setSun(hour) {
  const th = (hour - 6) / 12 * PI, c = cos(th), sn = sin(th);
  SUN[0] = c * SDX; SUN[1] = sn; SUN[2] = c * SDZ;
  SUN_SIDE = c >= 0 ? 0 : 1; SUN_TAN = sn <= 0 ? -1 : sn / max(abs(c), 1e-3);
}

let RMK; // where the sand is packed: ramps and pans (0..1), HN x HN at 2 m
const PAN0 = 0.38, PAN1 = 0.42, PAN2 = 0.47; // megadune noise below PAN0 is dead flat pan; ordinary dunes are full height by PAN1, megadunes by PAN2
let _ramp = 0; // set by duneH: how much of a ramp the last point was on
let AOQ; // how open to the sky each spot is (1 = open plain, lower in troughs), 512 x 512 at 4 m
let TH, HZ0, HZ1; // heights (m), TN x TN; skyline slope toward sunrise / sunset, HN x HN (2 m spacing)

const megaN = (u, v) => pfbm(u * 2 + 0.37, v * 2 + 0.11, 2, 2, 301 + WS); // where the megadunes are tall (high) or give out (low)
const panAt = (x, z) => 1 - sstep(PAN0, PAN1, megaN(x / TILE, z / TILE)); // 1 on a pan, 0 among the dunes
// height of the dune field at (x, z) in metres; periodic over TILE. The wind blows along +x:
// long gentle climbs on the windward side, a sharp crest, then a steep slip face.
const duneH = (x, z) => {
  const u = x / TILE, v = z / TILE;
  // pans: where the megadunes are lowest the sand gives out altogether, leaving hard flat ground hundreds of metres
  // across to build speed on. Around the edge the dunes do not stop at a wall: they shrink, keeping their shape,
  // the ordinary dunes over a short distance (pan) and the megadunes over a longer one (mg).
  const NM = megaN(u, v), pan = 1 - sstep(PAN0, PAN1, NM), mg = sstep(PAN0, PAN2, NM);
  const base = mix(16 * pfbm(u * 3, v * 3, 3, 3, 11 + WS), 3, pan);
  const amp = 5 + 24 * sstep(0.3, 0.75, pfbm(u * 5, v * 5, 5, 2, 23 + WS));
  const ph = u * 13 + v * 2 + 1.1 * pfbm(u * 6, v * 6, 6, 3, 37 + WS);
  // the slip face always rests near 32 degrees, so a taller dune has a longer one
  const A = amp * (0.65 + 0.7 * pnoise(u * 28, v * 28, 28, 51)) * (1 - pan);
  const t = ph - floor(ph), W = 1 - clamp(A * 1.6 / 157.5, 0.04, 0.42);
  const prof = t < W ? pow(t / W, 1.6) : pow(1 - (t - W) / (1 - W), 1.15);
  const ph2 = u * 41 - v * 7 + 0.8 * pfbm(u * 12, v * 12, 12, 2, 67 + WS);
  const t2 = ph2 - floor(ph2);
  const A2 = 2.2 * (0.4 + pnoise(u * 9, v * 9, 9, 71)) * (1 - pan), W2 = 1 - clamp(A2 * 1.7 / 50, 0.04, 0.4);
  const prof2 = t2 < W2 ? pow(t2 / W2, 1.5) : pow(1 - (t2 - W2) / (1 - W2), 1.15);
  // megadunes: three great ridges across the field, the tallest about five times the height of the ordinary dunes,
  // which ride on their backs. Same shape rules: a long windward climb, a slip face near the angle of repose.
  const AM = (40 + 222 * sstep(0.3, 0.72, NM)) * (0.8 + 0.35 * pnoise(u * 7, v * 7, 7, 311)) * mg;
  const pm = u * 3 + v + 0.9 * pfbm(u * 3, v * 3, 3, 3, 317 + WS), tm = pm - floor(pm), WM = 1 - clamp(AM * 1.6 / 683, 0.05, 0.5);
  // the crest is rounded over a few metres so it holds its line at a distance
  const profM = mix(pow(min(tm / WM, 1), 1.5), pow(1 - clamp((tm - WM) / (1 - WM), 0, 1), 1.15), sstep(WM - 0.012, WM + 0.012, tm));
  // a megadune's slip face is one smooth avalanche slope: the ordinary dunes do not survive on it
  const calmF = 1 - 0.88 * sstep(WM - 0.02, WM + 0.05, tm) * (1 - sstep(0.92, 1, tm));
  // Ramps. Four dunes in ten have one: a strip where the small dunes are swept away and the climb is graded into a
  // steady run-up that leads straight to the crest and ends in a lip to launch from. The field is cut into stretches
  // along each crest (256 m for megadunes, 85 m for ordinary dunes); a hash of dune and stretch picks which get one.
  const cM = floor(v * 8), dM = abs(v * 8 - cM - 0.5) * 256, onM = ihash(((floor(pm) % 3) + 3) % 3, cM, 401 + WS) < 0.4 ? sstep(0.15, 0.45, mg) : 0;
  const sM = min(tm / WM, 1), latM = onM * (1 - sstep(12, 40, dM)), clearM = onM * (1 - sstep(16, 44, dM)) * sstep(0.08, 0.2, tm) * (1 - sstep(WM + 0.02, WM + 0.04, tm));
  const rampM = latM * AM * (pow(sM, 1.3) - pow(sM, 1.5) + 0.03 * sstep(0.84, 1, sM) * (1 - sstep(WM, WM + 0.022, tm)));
  const c1 = floor(v * 24), d1 = abs(v * 24 - c1 - 0.5) * 85.3, on1 = ihash(((floor(ph) % 13) + 13) % 13, c1, 409 + WS) < 0.4 ? 1 : 0;
  const s1 = min(t / W, 1), lat1 = on1 * (1 - sstep(4, 12, d1)), clear1 = lat1 * sstep(0.1, 0.25, t) * (1 - sstep(W + 0.03, W + 0.06, t));
  const ramp1 = lat1 * A * (pow(s1, 1.25) - pow(s1, 1.6) + 0.07 * sstep(0.8, 1, s1) * (1 - sstep(W, W + 0.05, t)));
  _ramp = max(max(clearM, clear1 * calmF * (1 - pan)), pan);
  return base + AM * profM + rampM + ((A * prof + ramp1) * (1 - 0.92 * clearM) + A2 * prof2 * (1 - 0.92 * max(clearM, clear1))) * calmF + 0.5 * pfbm(u * 64, v * 64, 64, 2, 83 + WS) * (1 - 0.8 * _ramp);
};

// ground height exactly as the terrain mesh draws it (each 1 m cell is two triangles split along its diagonal)
const heightAt = (x, z) => {
  const fx0 = floor(x), fz0 = floor(z), fx = x - fx0, fz = z - fz0;
  const i = fx0 & TM, j = fz0 & TM, i1 = (i + 1) & TM, j1 = (j + 1) & TM;
  const a = TH[i + j * TN], b = TH[i1 + j * TN], c = TH[i1 + j1 * TN], d = TH[i + j1 * TN];
  return fx >= fz ? a + (b - a) * fx + (c - b) * fz : a + (c - d) * fx + (d - a) * fz;
};
const _gn = [0, 1, 0];
// smoothed ground normal into _gn
const groundNormal = (x, z) => {
  const e = 0.7, dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  const l = 1 / sqrt(dx * dx + dz * dz + 1);
  _gn[0] = -dx * l; _gn[1] = l; _gn[2] = -dz * l;
};
// how much direct sun reaches the ground at (x, z) right now; same test as the terrain shader
const shadowAt = (x, z) => { const hz = (SUN_SIDE ? HZ1 : HZ0)[(round(x * 0.5) & HM) + (round(z * 0.5) & HM) * HN]; return sstep(hz - 0.02, hz + 0.035, SUN_TAN); };

// builds TH and the skyline maps, then returns the mip chain for the GPU texture
// (rgba16float: normal.x, normal.z, skyline toward sunrise, skyline toward sunset).
// `tick(fraction)` is awaited now and then so the loading bar can move.
async function buildTerrain(tick) {
  TH = new Float32Array(TN * TN); HZ0 = new Float32Array(HN * HN); HZ1 = new Float32Array(HN * HN); RMK = new Float32Array(HN * HN);
  const D0 = new Float32Array(HN * HN), D1 = new Float32Array(HN * HN); // how far away the terrain that forms each skyline is
  let hmax = -1e9;
  for (let j = 0; j < TN; j++) {
    for (let i = 0; i < TN; i++) { const h = duneH(i, j); TH[i + j * TN] = h; if (h > hmax) hmax = h; if (!((i | j) & 1)) RMK[(i >> 1) + (j >> 1) * HN] = _ramp; }
    if ((j & 127) === 127) await tick(0.05 + 0.45 * j / TN);
  }
  // skyline: the steepest line of sight to any terrain in each of the two sun directions
  for (let j = 0; j < HN; j++) {
    for (let i = 0; i < HN; i++) {
      const x = i * 2, z = j * 2, h0 = TH[x + z * TN] + 0.05, cap = hmax - h0;
      for (let k = 0; k < 2; k++) {
        const sx = k ? -SDX : SDX, sz = k ? -SDZ : SDZ; let mx = -0.5, t = 1.5, td = 0;
        while (t < 1500 && cap / t > mx) { const tv = (heightAt(x + sx * t, z + sz * t) - h0) / t; if (tv > mx) { mx = tv; td = t; } t += 1 + t * 0.07; }
        (k ? HZ1 : HZ0)[i + j * HN] = mx; (k ? D1 : D0)[i + j * HN] = td;
      }
    }
    if ((j & 63) === 63) await tick(0.5 + 0.38 * j / HN);
  }
  const NXf = new Float32Array(TN * TN), NZf = new Float32Array(TN * TN), A0 = new Float32Array(TN * TN), A1 = new Float32Array(TN * TN);
  for (let j = 0; j < TN; j++) {
    const jm = ((j - 1) & TM) * TN, jp = ((j + 1) & TM) * TN, j0 = j * TN, hj = (j >> 1) * HN, hj1 = (((j >> 1) + 1) & HM) * HN, fj = (j & 1) * 0.5;
    for (let i = 0; i < TN; i++) {
      const dx = (TH[((i + 1) & TM) + j0] - TH[((i - 1) & TM) + j0]) * 0.5, dz = (TH[i + jp] - TH[i + jm]) * 0.5, l = 1 / sqrt(dx * dx + dz * dz + 1);
      NXf[i + j0] = -dx * l; NZf[i + j0] = -dz * l;
      const hi = i >> 1, hi1 = (hi + 1) & HM, fi = (i & 1) * 0.5;
      A0[i + j0] = mix(mix(HZ0[hi + hj], HZ0[hi1 + hj], fi), mix(HZ0[hi + hj1], HZ0[hi1 + hj1], fi), fj);
      A1[i + j0] = mix(mix(HZ1[hi + hj], HZ1[hi1 + hj], fi), mix(HZ1[hi + hj1], HZ1[hi1 + hj1], fi), fj);
    }
  }
  await tick(0.9);
  // openness: how much of the sky dome the surrounding dunes leave visible, from the skyline in 8 directions
  const QN = 512, QM = QN - 1, AD = [], AT = [3, 6, 10, 16, 26, 40, 60];
  for (let k = 0; k < 8; k++) AD.push([cos(k * TAU / 8 + 0.2), sin(k * TAU / 8 + 0.2)]);
  AOQ = new Float32Array(QN * QN);
  for (let j = 0; j < QN; j++) for (let i = 0; i < QN; i++) {
    const x = i * 4, z = j * 4, h0 = TH[x + z * TN] + 0.05; let sm = 0;
    for (const d of AD) { let mx = 0; for (const t of AT) { const tv = (heightAt(x + d[0] * t, z + d[1] * t) - h0) / t; if (tv > mx) mx = tv; } sm += mx / sqrt(1 + mx * mx); }
    AOQ[i + j * QN] = 1 - sm / 8;
  }
  // second texture, HN x HN rgba16float: skyline distance toward sunrise / sunset, openness, ramps
  const tx = new Uint16Array(HN * HN * 4);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const qi = i >> 1, qj = j >> 1, q1 = (qi + 1) & QM, r1 = (qj + 1) & QM, fi = (i & 1) * 0.5, fj = (j & 1) * 0.5, o = (i + j * HN) * 4;
    tx[o] = toHalf(D0[i + j * HN]); tx[o + 1] = toHalf(D1[i + j * HN]); tx[o + 3] = toHalf(RMK[i + j * HN]);
    tx[o + 2] = toHalf(mix(mix(AOQ[qi + qj * QN], AOQ[q1 + qj * QN], fi), mix(AOQ[qi + r1 * QN], AOQ[q1 + r1 * QN], fi), fj));
  }
  // mip chain (box filter), packed as half floats
  const mips = [];
  let n = TN, C = [NXf, NZf, A0, A1];
  for (;;) {
    const d = new Uint16Array(n * n * 4);
    for (let k = 0; k < n * n; k++) { d[k * 4] = toHalf(C[0][k]); d[k * 4 + 1] = toHalf(C[1][k]); d[k * 4 + 2] = toHalf(C[2][k]); d[k * 4 + 3] = toHalf(C[3][k]); }
    mips.push({ n, d });
    if (n === 1) break;
    const m = n >> 1, D = C.map(() => new Float32Array(m * m));
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const a = i * 2 + j * 2 * n, o = i + j * m;
      for (let c = 0; c < 4; c++) D[c][o] = (C[c][a] + C[c][a + 1] + C[c][a + n] + C[c][a + n + 1]) * 0.25;
    }
    n = m; C = D;
  }
  await tick(0.93);
  return { mips, tx };
}

// ---------------------------------------------------------------- sky
// Single-scattering atmosphere (Rayleigh + Mie). The GPU renders it into a small texture whenever the sun moves
// (W_SKYBAKE in shaders.js is the same maths); this copy gives the CPU the light totals.
const ATM = { rP: 6371e3, rA: 6471e3, kR: [5.5e-6, 13.0e-6, 22.4e-6], kM: 21e-6, hR: 8e3, hM: 1.2e3, g: 0.76, I: 22 };
const SKW = 256, SKH = 128;
// distance along (dx,dy,dz) from height y0 above the planet centre to a sphere of radius R (far hit), or -1
const _sph = (y0, dy, R) => { const b = y0 * dy, c = y0 * y0 - R * R, d = b * b - c; return d < 0 ? -1 : -b + sqrt(d); };
const _sky = [0, 0, 0];
function skyColor(dx, dy, dz) {
  const A = ATM, y0 = A.rP + 300, tEnd = _sph(y0, dy, A.rA), NI = 16, NJ = 6, ds = tEnd / NI;
  const mu = dx * SUN[0] + dy * SUN[1] + dz * SUN[2], gg = A.g * A.g;
  const pR = 3 / (16 * PI) * (1 + mu * mu), pM = 3 / (8 * PI) * ((1 - gg) * (1 + mu * mu)) / (pow(1 + gg - 2 * mu * A.g, 1.5) * (2 + gg));
  let oR = 0, oM = 0, r = 0, g = 0, b = 0, m0 = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < NI; i++) {
    const t = (i + 0.5) * ds, px = dx * t, py = y0 + dy * t, pz = dz * t, pl = hypot(px, py, pz), h = pl - A.rP;
    const sR = exp(-h / A.hR) * ds, sM = exp(-h / A.hM) * ds; oR += sR; oM += sM;
    // toward the sun from this point
    const bq = px * SUN[0] + py * SUN[1] + pz * SUN[2], dq = bq * bq - (pl * pl - A.rA * A.rA), tj = (-bq + sqrt(max(dq, 0))) / NJ;
    let jR = 0, jM = 0;
    for (let j = 0; j < NJ; j++) {
      const s = (j + 0.5) * tj, hj = hypot(px + SUN[0] * s, py + SUN[1] * s, pz + SUN[2] * s) - A.rP;
      jR += exp(-hj / A.hR) * tj; jM += exp(-hj / A.hM) * tj;
    }
    const aM = A.kM * (oM + jM);
    const e0 = exp(-(aM + A.kR[0] * (oR + jR))), e1 = exp(-(aM + A.kR[1] * (oR + jR))), e2 = exp(-(aM + A.kR[2] * (oR + jR)));
    r += sR * e0; g += sR * e1; b += sR * e2; m0 += sM * e0; m1 += sM * e1; m2 += sM * e2;
  }
  // x 1.5: single scattering alone leaves the sky too dark against the ground; this stands in for the rest
  const K = A.I * 1.5;
  _sky[0] = K * (pR * A.kR[0] * r + pM * A.kM * m0); _sky[1] = K * (pR * A.kR[1] * g + pM * A.kM * m1); _sky[2] = K * (pR * A.kR[2] * b + pM * A.kM * m2);
}
// Light for the current sun position: SUNC = sunlight on a surface facing the sun, AMB = light from the whole sky
// on flat ground (plus a little moon and starlight so night is never pitch black).
const SUNC = [0, 0, 0], AMB = [0, 0, 0];
function skyLight() {
  const A = ATM, y0 = A.rP + 300, te = _sph(y0, SUN[1], A.rA), N = 32, ds = te / N; let oR = 0, oM = 0;
  for (let i = 0; i < N; i++) { const t = (i + 0.5) * ds, h = max(hypot(SUN[0] * t, y0 + SUN[1] * t, SUN[2] * t) - A.rP, -2e4); oR += exp(-h / A.hR) * ds; oM += exp(-h / A.hM) * ds; }
  const up = sstep(-0.015, 0.03, SUN[1]);
  for (let k = 0; k < 3; k++) SUNC[k] = A.I * exp(-(A.kR[k] * oR + A.kM * oM)) * up;
  const NA = 12, NE = 6; AMB[0] = 0.002; AMB[1] = 0.0042; AMB[2] = 0.0095;
  for (let j = 0; j < NE; j++) {
    const v = (j + 0.5) / NE, y = v * v, c = sqrt(1 - y * y), w = y * (TAU / NA) * (2 * v / NE);
    for (let i = 0; i < NA; i++) { const az = (i + 0.5) / NA * TAU; skyColor(sin(az) * c, y, cos(az) * c); AMB[0] += _sky[0] * w; AMB[1] += _sky[1] * w; AMB[2] += _sky[2] * w; }
  }
}
