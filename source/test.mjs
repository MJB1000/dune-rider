// Headless sanity check of the terrain and the bike physics:  node test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js', 'bike.js', 'props.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
const run = new Function(src + `
return (async () => {
  let t0 = Date.now();
  const { mips } = await buildTerrain(async () => {});
  let lo = 1e9, hi = -1e9, steep = 0;
  for (let i = 0; i < TN * TN; i++) { lo = min(lo, TH[i]); hi = max(hi, TH[i]); }
  for (let i = 0; i < TN * TN - 1; i++) steep = max(steep, abs(TH[i + 1] - TH[i]));
  console.log('terrain', Date.now() - t0, 'ms  height', lo.toFixed(1), '..', hi.toFixed(1), ' steepest', (Math.atan(steep) * 57.3).toFixed(0) + 'deg  mips', mips.length);
  for (const h of [6.5, 9, 12, 16.5, 18, 21]) { setSun(h); skyLight(); let lit = 0; for (let k = 0; k < 4000; k++) lit += shadowAt(k * 37.1, k * 91.7); console.log('hour', String(h).padStart(4), ' sun height', (Math.asin(SUN[1]) * 57.3).toFixed(0) + 'deg  sunlight', SUNC.map((v) => v.toFixed(2)).join(' '), ' sky', AMB.map((v) => v.toFixed(3)).join(' '), ' lit', (lit / 40).toFixed(0) + '%'); }
  const log = (tag) => console.log(tag.padEnd(14), 'pos', B.x.toFixed(1), (B.y - heightAt(B.x, B.z)).toFixed(2), B.z.toFixed(1), ' v', (B.speed * 3.6).toFixed(0) + 'km/h', ' pitch', B.pitch.toFixed(2), ' yaw', B.yaw.toFixed(2), ' lean', B.lean.toFixed(2), ' comp', B.cF.toFixed(2), B.cR.toFixed(2), ' crash', B.crash > 0 ? 1 : 0);
  const sim = (s) => { let air = 0, crashes = 0, was = 0, vmax = 0; for (let i = 0; i < s * 240; i++) { stepBike(1 / 240); if (!(B.gF > 0 || B.gR > 0)) air++; if (B.crash > 0 && !was) crashes++; was = B.crash > 0; vmax = max(vmax, B.speed); if (!isFinite(B.x + B.y + B.q + B.r)) throw new Error('NaN at step ' + i); } return ' air ' + (air / 240).toFixed(1) + 's crashes ' + crashes + ' vmax ' + (vmax * 3.6).toFixed(0); };
  for (const [x, z, yaw] of [[300, 300, PI / 2], [900, 1200, 0], [1500, 500, -PI / 2]]) {
    console.log('--- spawn', x, z, yaw.toFixed(2));
    resetBike(x, z, yaw); IN.thr = 0; IN.brk = 0; IN.steer = 0; let r = sim(3); log('rest' + r);
    IN.thr = 1; r = sim(4); log('throttle 4s'); console.log(r);
    r = sim(16); log('throttle 20s'); console.log(r);
    IN.steer = 0.6; IN.thr = 0.6; r = sim(6); log('turning'); console.log(r);
    IN.steer = 0; IN.thr = 0; IN.brk = 1; r = sim(6); log('braking'); console.log(r);
  }
  // mesh normals should point outward
  if (typeof buildBike === 'function') {
    const parts = buildBike();
    for (const [name, m] of Object.entries(parts)) {
      console.log('mesh', name.padEnd(8), 'verts', m.nv, 'tris', m.ib.length / 3);
    }
  }
  const outward = (name, mk) => { const m = new Mesh(); mk(m); const b = m.build(), P = new Float32Array(b.vb); let o = 0; for (let k = 0; k < b.nv; k++) if (P[k * 4] * b.N[k * 3] + P[k * 4 + 1] * b.N[k * 3 + 1] + P[k * 4 + 2] * b.N[k * 3 + 2] > 0) o++; console.log('outward', name.padEnd(6), (o / b.nv * 100).toFixed(0) + '%'); };
  outward('tube', (m) => m.tube([[0, -1, 0], [0, 1, 0]], 0.5));
  outward('sweep', (m) => m.sweep([[0, 0, -1], [0, 0, 1]], 1, 1));
  { const m = new Mesh(); m.lathe([[1, -0.2], [1.2, -0.2], [1.2, 0.2], [1, 0.2]], 16); const b = m.build(), P = new Float32Array(b.vb); let o = 0, n = 0; for (let k = 0; k < b.nv; k++) if (hypot(P[k * 4 + 1], P[k * 4 + 2]) > 1.19) { n++; if (P[k * 4 + 1] * b.N[k * 3 + 1] + P[k * 4 + 2] * b.N[k * 3 + 2] > 0) o++; } console.log('outward lathe rim', o, '/', n); }
  outward('blob', (m) => m.blob(1, (x, y, z) => [x, y, z]));
})();`);
await run();
