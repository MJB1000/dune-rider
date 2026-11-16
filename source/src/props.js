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

// ============================================================================
// landmarks: five things to find, each one mesh modelled here, origin on the ground, y up.
// name, how close counts as buzzing it in the air (m), and what can be hit:
// [x, z, radius, y0, y1] upright cylinders in the landmark's own frame, or 'ring' for the arch.
// ============================================================================
function buildLandmarks() {
  const L = [];
  { // radio mast, 88 m, red and white, guyed
    const m = new Mesh();
    for (let i = 0; i < 8; i++) { m.a = i & 1 ? M_LWHITE : M_LRED; m.tube([[0, i * 10 - 1, 0], [0, i * 10 + 10, 0]], (k) => 0.55 - 0.035 * (i + k), 8); }
    m.a = M_STEEL; m.tube([[0, 80, 0], [0, 88, 0]], 0.09, 6);
    for (const p of [28, 54, 76]) m.tube([[0, p, 0], [0, p + 0.3, 0]], 1.6, 10);
    for (let g = 0; g < 3; g++) { const a = g * TAU / 3; for (const h of [30, 62]) m.tube([[sin(a) * 0.5, h, cos(a) * 0.5], [sin(a) * 38, -1, cos(a) * 38]], 0.09, 5); }
    L.push({ name: 'THE MAST', site: 'high', R: 14, cy: 45, cols: [[0, 0, 1.3, 0, 88]], mesh: m.build() });
  }
  { // stone arch, 40 m across, to ride or fly through
    const m = new Mesh(); m.a = M_LSTONE; const pts = [];
    for (let i = 0; i <= 16; i++) { const a = PI * i / 16; pts.push([cos(a) * 20, sin(a) * 20 - 1, sin(i * 2.1) * 1.2]); }
    m.tube(pts, (k) => 3.6 - 1.3 * sin(PI * k / 16) + 0.4 * sin(k * 1.7), 9);
    for (const s of [-1, 1]) m.blob(1, (x, y, z) => [s * 22 + x * 4.5, y * 3 + 0.5, z * 4 + s * 2]);
    L.push({ name: 'THE ARCH', site: 'flat', R: 13, cy: 8, ring: 1, cols: [], mesh: m.build() });
  }
  { // wrecked aeroplane, nose down in the sand, one wing torn off
    const m = new Mesh();
    m.a = M_LWHITE; m.loft([[0, 1.3, 11], [0, 1.7, 8], [0, 1.9, -4], [0, 2.6, -11]], (k) => [0.9, 2.6, 2.6, 0.5][k], (k) => [0.9, 2.8, 2.6, 0.7][k], 14, 2.2);
    m.loft([[1.2, 1.4, 1.5], [7, 1.7, 0.8], [13, 2.1, 0]], (k) => [3.6, 2.8, 1.6][k], (k) => [0.5, 0.35, 0.15][k], 10, 2.5);
    m.loft([[-4, 2.8, -9.5], [4, 2.8, -9.5]], 1.8, 0.2, 8, 2.5);
    m.loft([[-6, 0.2, 6], [-13, 0.12, 9]], 3, 0.3, 8, 2.5);
    m.a = M_LRED; m.loft([[0, 2.9, -9], [0, 6.2, -11]], 2.2, 0.25, 8, 2.5, [1, 0, 0]);
    m.a = M_LRUST; m.tube([[5, 1.2, 3.4], [5, 1.2, 0.2]], 0.7, 10); m.tube([[0, 1.4, 11.6], [0, 1.3, 10.6]], 0.75, 10);
    L.push({ name: 'THE WRECK', site: 'flat', R: 16, cy: 2, cols: [[0, 6, 2.2, 0, 3.6], [0, 0, 2.4, 0, 3.8], [0, -6, 2.2, 0, 3.8]], mesh: m.build() });
  }
  { // oasis: a pool ringed with palms
    const m = new Mesh(); m.a = M_LWATER; m.blob(2, (x, y, z) => [x * 13, y * 0.12 + 0.08, z * 9]);
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 + 0.3 * sin(i * 3), r = 11 + 3 * sin(i * 1.7), bx = cos(a) * r, bz = sin(a) * r * 0.75, h = 7 + 3 * sin(i * 2.3) * sin(i * 2.3), lx = sin(i * 5) * 1.5, lz = cos(i * 3) * 1.5;
      m.a = M_LTRUNK; m.tube([[bx, -0.5, bz], [bx + lx * 0.3, h * 0.4, bz + lz * 0.3], [bx + lx * 0.7, h * 0.75, bz + lz * 0.7], [bx + lx, h, bz + lz]], (k) => 0.34 - 0.05 * k, 7);
      m.a = M_LLEAF;
      for (let f = 0; f < 7; f++) { const fa = f * TAU / 7 + i, dx = cos(fa), dz = sin(fa); m.loft([[bx + lx, h, bz + lz], [bx + lx + dx * 1.8, h + 0.6, bz + lz + dz * 1.8], [bx + lx + dx * 3.6, h - 0.6, bz + lz + dz * 3.6]], (k) => [0.5, 1.0, 0.15][k], 0.06, 6, 2); }
    }
    L.push({ name: 'THE OASIS', site: 'flat', R: 18, cy: 6, cols: [], mesh: m.build() });
  }
  { // the bones of something very large
    const m = new Mesh(); m.a = M_LBONE;
    m.tube([[0, 1.2, -20], [0, 1.6, -8], [0, 1.6, 8], [0, 0.9, 20]], (k) => [0.25, 0.5, 0.5, 0.3][k], 8);
    for (let i = 0; i < 11; i++) {
      const z = -17 + i * 3.2, R = 3.2 + 3.4 * sin(PI * (i + 0.5) / 11);
      for (const s of [-1, 1]) { const pts = []; for (let k = 0; k <= 7; k++) { const a = k / 7 * 2.5; pts.push([s * R * sin(a), 1.5 + R * (1 - cos(a)) * 0.9, z + k * 0.15]); } m.tube(pts, (k) => 0.26 - 0.025 * k, 6); }
    }
    m.blob(2, (x, y, z) => [x * 2.2, 2.2 + y * 1.8, 24 + z * 3.6]);
    L.push({ name: 'THE BONES', site: 'flat', R: 12, cy: 5, cols: [], mesh: m.build() });
  }
  return L;
}
