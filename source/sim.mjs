// Simulations from BRIEF.md section 6:  node sim.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = ['math.js', 'terrain.js', 'physics.js'].map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
const run = new Function(src + `
return (async () => {
  await buildTerrain(async () => {});
  const pct = (a, p) => { const s = Float64Array.from(a).sort(); return s[min(s.length - 1, floor(s.length * p))]; };

  // ---- S1 + S2: physics stress with a random but plausible rider
  let seed = 12345; const R = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  const DT = 1 / 240, RUNS = 30, SECS = 90;
  let crashes = 0, stuckEv = 0, clampSteps = 0, steps = 0, vmax = 0, airTot = 0, airMax = 0, wheelie = 0, landMax = 0, nan = 0, minClear = 9;
  const causes = {}, qs = [], rolls = [], accs = [], crashLog = [];
  for (let run = 0; run < RUNS; run++) {
    resetBike(R() * TILE, R() * TILE, R() * TAU);
    let seg = 0, stuckT = 0, prevCrash = 0, prevVy = 0, prevLean = 0, lastAir = 0, sinceAir = 9;
    for (let i = 0; i < SECS * 240; i++) {
      if (seg <= 0) { seg = 0.4 + R() * 2.5; IN.thr = R() < 0.8 ? 0.5 + R() * 0.5 : 0; IN.brk = IN.thr === 0 && R() < 0.5 ? R() : 0; IN.steer = R() < 0.45 ? 0 : (R() * 2 - 1) * (R() < 0.3 ? 1 : 0.5); }
      seg -= DT;
      const wasAir = B.air, gBefore = B.gF > 0 || B.gR > 0, vyBefore = B.vy, uYb = cos(B.pitch), spB = B.speed;
      stepBike(DT); steps++;
      if (!isFinite(B.x + B.y + B.z + B.q + B.r + B.pitch)) { nan++; break; }
      const clr = B.y - heightAt(B.x, B.z); if (clr < minClear) minClear = clr; if (clr < 0.2201) clampSteps++;
      if (B.air > 0) { airTot += DT; if (B.air > airMax) airMax = B.air; lastAir = B.air; sinceAir = 0; } else sinceAir += DT;
      if (wasAir > 0.2 && B.air === 0 && -vyBefore > landMax) landMax = -vyBefore;
      if (B.gR > 0 && B.gF === 0 && B.crash <= 0) wheelie += DT;
      if (B.speed > vmax) vmax = B.speed;
      if (B.crash > 0 && prevCrash <= 0) {
        crashes++;
        const c = sinceAir < 0.3 ? (uYb < 0.3 ? 'landed upside down / nose first' : 'hard landing, head hit') : uYb < 0.2 ? 'looped out on the ground' : 'head hit slope while riding';
        causes[c] = (causes[c] || 0) + 1; if (crashLog.length < 6) crashLog.push(c + ' | air ' + lastAir.toFixed(1) + 's speed ' + (spB * 3.6).toFixed(0) + ' pitch ' + B.pitch.toFixed(2));
      }
      prevCrash = B.crash;
      if (IN.thr > 0.5 && B.speed < 1 && B.crash <= 0) { stuckT += DT; if (stuckT > 3) { stuckEv++; stuckT = -1e9; } } else if (stuckT > 0) stuckT = 0;
      if (B.crash <= 0 && (i & 3) === 0) { qs.push(abs(B.q)); rolls.push(abs(B.lean - prevLean) / (4 * DT)); accs.push(abs(B.vy - prevVy) / (4 * DT)); prevLean = B.lean; prevVy = B.vy; }
    }
  }
  const T = steps * DT;
  console.log('S1 physics stress:', RUNS, 'runs x', SECS, 's');
  console.log('   NaN', nan, '| crashes', crashes, '(' + (crashes / T * 60).toFixed(1) + '/min) | stuck events', stuckEv, '| floor-clamp time', (clampSteps * DT).toFixed(1) + 's', '| min clearance', minClear.toFixed(2));
  console.log('   vmax', (vmax * 3.6).toFixed(0), 'km/h | air', (airTot / T * 100).toFixed(0) + '% of time, longest', airMax.toFixed(1) + 's | hardest landing', landMax.toFixed(1), 'm/s | front wheel up', (wheelie / T * 100).toFixed(0) + '%');
  console.log('   crash causes', JSON.stringify(causes)); for (const c of crashLog) console.log('     ', c);
  console.log('S2 POV comfort: pitch rate p50/p95/p99', [0.5, 0.95, 0.99].map((p) => pct(qs, p).toFixed(2)).join(' / '), 'rad/s | lean rate p95/p99', [0.95, 0.99].map((p) => pct(rolls, p).toFixed(2)).join(' / '), 'rad/s | vertical accel p95/p99', [0.95, 0.99].map((p) => (pct(accs, p) / 9.81).toFixed(1)).join(' / '), 'g');

  // ---- S3 + S4: shadows and light through the day (the bake itself is timed by test.mjs)
  console.log('S3/S4 through the day: hour, sun height, lit ground, sunlight, sky light, exposure needed for sunlit sand');
  for (const h of [4, 5.5, 6, 6.2, 6.5, 7, 8, 10, 12, 14, 16, 17, 17.5, 17.8, 18, 18.5, 20]) {
    setSun(h); skyLight(); let lit = 0; for (let k = 0; k < 6000; k++) lit += shadowAt(k * 37.1, k * 91.7);
    const L = [0, 1, 2].map((k) => SAND[k] / PI * (SUNC[k] * max(SUN[1], 0) + AMB[k])), lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
    console.log('   ' + h.toFixed(1).padStart(5), (Math.asin(SUN[1]) * 57.3).toFixed(0).padStart(4) + 'deg  lit', (lit / 60).toFixed(0).padStart(3) + '%  sun', SUNC.map((v) => v.toFixed(2)).join(' '), ' sky', AMB.map((v) => v.toFixed(3)).join(' '), ' expo', (0.5 / lum).toFixed(2), isFinite(lum) ? '' : ' <-- NOT FINITE');
  }
})();`);
await run();
