// ============================================================================
// things on the sand, for the eye to measure it against: stones and gravel in the sheltered low ground, clumps of
// dune grass. Built once at load; the bike rides through them.
// ============================================================================
function buildProps() {
  let m = new Mesh();
  m.a = 10;
  m.blob(2, (x, y, z) => { const n = 0.7 + 0.6 * pnoise(x * 1.9 + 7 + z, y * 1.9 + 3 - z * 1.3, 64, 91); return [x * n, y * n * 0.72, z * n]; });
  const rock = m.build();
  m = new Mesh();
  m.a = 10;
  m.blob(1, (x, y, z) => { const n = 0.75 + 0.5 * pnoise(x * 2.3 + 4 - z, y * 2.3 + 8 + z * 1.7, 64, 97); return [x * n, y * n * 0.6, z * n]; });
  const pebble = m.build();
  // instances: x, y, z, size | yaw, vertical squash, height factor for the shadow, half width for the shadow
  const rocks = [], tufts = [], pebbles = [], blades = [];
  const ao = (x, z) => AOQ[(round(x / 4) & 511) + (round(z / 4) & 511) * 512];
  const onRamp = (x, z) => RMK[(round(x / 2) & HM) + (round(z / 2) & HM) * HN] > 0.15;
  const tuft = (x, z, s) => tufts.push(x, heightAt(x, z), z, s, 0, 1, 0.55, 0.42);
  rseed(1);
  for (let i = 0; i < 90000; i++) {
    const x = rr(0, TILE), z = rr(0, TILE);
    groundNormal(x, z);
    // gather in the sheltered low ground, in patches; a few strays everywhere
    const patch = pnoise(x / 32, z / 32, 64, 131), want = sstep(0.93, 0.84, ao(x, z)) * sstep(0.35, 0.7, patch) + 0.02;
    if (_gn[1] < 0.955 || rnd() > want || onRamp(x, z)) continue;
    if (rnd() < 0.3) tuft(x, z, rr(0.5, 1.1));
    else { const s = 0.12 + 1.1 * pow(rnd(), 2.4), q = rr(0.55, 1.1); rocks.push(x, heightAt(x, z) - s * q * 0.12, z, s, rr(0, TAU), q, q * 0.75, 0.85); }
  }
  // grass also grows in its own drifts on the gentler open sand
  rseed(2);
  for (let i = 0; i < 80000; i++) {
    const x = rr(0, TILE), z = rr(0, TILE), gp = sstep(0.5, 0.72, pnoise(x / 64, z / 64, 32, 171)) * sstep(0.985, 0.9, ao(x, z));
    if (rnd() > gp * 0.07 + 0.003 || onRamp(x, z)) continue;
    groundNormal(x, z); if (_gn[1] < 0.94) continue;
    tuft(x, z, rr(0.3, 0.8));
  }
  // gravel: beds of small stones on the hard floor between dunes
  rseed(3);
  for (let i = 0; i < (160000 >> LV); i++) {
    const x = rr(0, TILE), z = rr(0, TILE), gp = sstep(0.56, 0.78, pnoise(x / 32, z / 32, 64, 211)) * sstep(0.95, 0.86, ao(x, z));
    if (rnd() > gp * 0.65 || onRamp(x, z)) continue;
    const s = 0.02 + 0.075 * pow(rnd(), 2);
    pebbles.push(x, heightAt(x, z) + s * 0.15, z, s, rr(0, TAU), rr(0.5, 1), 0, 0);
  }
  // blades: root x, y, z, height | lean direction, lean, width, seed
  rseed(4);
  for (let t = 0; t < tufts.length; t += 8) {
    const s = tufts[t + 3], n = round((24 + 30 * s) / (1 << LV)), R = 0.24 * s;
    for (let k = 0; k < n; k++) {
      const an = rr(0, TAU), r = sqrt(rnd()) * R, x = tufts[t] + cos(an) * r, z = tufts[t + 2] + sin(an) * r;
      blades.push(x, heightAt(x, z) - 0.02, z, s * rr(0.4, 1) * (1 - 0.45 * r / R), an + rr(-0.7, 0.7), rr(0.2, 0.95), rr(0.006, 0.013), rnd());
    }
  }
  return { rock, pebble, rocks: new Float32Array(rocks), pebbles: new Float32Array(pebbles), tufts: new Float32Array(tufts), blades: new Float32Array(blades) };
}
