// ============================================================================
// the bike and rider. Body coordinates: origin at the centre of mass, x right, y up, z forward; the ground is about
// 0.67 below the origin when the bike sits on its wheels. Modelled on a 450 cc motocross bike.
// Parts that move separately: chassis, upper fork (steers), lower fork (steers + slides), the two wheels, and the
// rider: torso, helmet and eight limb segments.
// Material ids index the palette in the bike shader.
// ============================================================================
const M_TYRE = 0, M_FRAME = 1, M_PLASTIC = 2, M_SEAT = 3, M_ALU = 4, M_SUIT = 5, M_WHITE = 6, M_BOOT = 7, M_STEEL = 8, M_SUIT2 = 9,
  M_ENGINE = 10, M_PANTS = 11, M_VISOR = 12, M_LAMP = 13, M_RIM = 14, M_SPRING = 15, M_SLEEVE = 16, M_WING = 17, M_FLAME = 18;
// steering axis: through the steering head, down the fork to the front axle
const HEAD = [0, 0.30, 0.42], FAX = [0, 0.900, -0.436];        // FAX points up the fork
const AXF = [0, -BK.L, BK.a + 0.039];                          // front axle, suspension fully out
const SLIDE = [0, 1, -0.484];                                  // axle travel per metre of compression
const GRIP = [0.335, 0.505, 0.345];                             // right hand on the bars; mirrored for the left
const EYE = [0, 0.92, -0.05];                                  // first-person camera: a little behind and below the real eyes so the bars are in view
const LR = [-1, 1];
const NOZ = [0.14, 0.372, -1.21];                              // right booster's nozzle exit; mirrored for the left

function buildWheel(R, w, rear) {
  const m = new Mesh(), h = w / 2;
  // carcass: rounded shoulders, flat-ish crown
  m.a = M_TYRE;
  m.lathe([[R - 0.105, -h * 0.72], [R - 0.06, -h * 0.98], [R - 0.022, -h], [R - 0.004, -h * 0.7], [R, -h * 0.3], [R, h * 0.3], [R - 0.004, h * 0.7], [R - 0.022, h], [R - 0.06, h * 0.98], [R - 0.105, h * 0.72]], 48);
  // tread blocks: x across the tyre, kw wide, kl long around it, kh tall
  const knob = (an, x, kw, kl, kh) => {
    const c = cos(an), s = sin(an), r0 = R + kh * 0.3 - (abs(x) > h * 0.6 ? 0.014 : abs(x) > h * 0.3 ? 0.003 : 0);
    m.sweep([[x - kw / 2, r0 * c, r0 * s], [x + kw / 2, r0 * c, r0 * s]], kl, kh, () => [0, c, s]);
  };
  if (rear) {
    // sand paddles: scoops across the full width, with side knobs between them
    for (let i = 0; i < 10; i++) { const an = i / 10 * TAU; knob(an, 0, w * 0.86, 0.03, 0.036); for (const s of LR) knob(an + TAU / 20, s * h * 0.82, 0.022, 0.05, 0.016); }
  } else {
    for (let i = 0; i < 26; i++) {
      const an = i / 26 * TAU, a2 = an + TAU / 52;
      knob(an, 0, 0.026, 0.03, 0.014);
      for (const s of LR) { knob(a2, s * h * 0.42, 0.022, 0.03, 0.014); knob(an, s * h * 0.82, 0.02, 0.034, 0.014); }
    }
  }
  m.a = M_RIM;
  m.lathe([[R - 0.122, -0.036], [R - 0.108, -0.044], [R - 0.094, -0.04], [R - 0.094, 0.04], [R - 0.108, 0.044], [R - 0.122, 0.036]], 48);
  m.a = M_ALU;
  m.tube([[-0.07, 0, 0], [0.07, 0, 0]], 0.032, 14);
  for (const s of LR) m.lathe([[0.03, s * 0.05 - 0.004], [0.052, s * 0.05 - 0.004], [0.052, s * 0.05 + 0.004], [0.03, s * 0.05 + 0.004]], 18);
  m.a = M_STEEL;
  // brake disc on the right; drive sprocket on the left of the rear wheel
  m.lathe([[0.05, 0.068], [0.12, 0.068], [0.12, 0.072], [0.05, 0.072]], 28);
  if (rear) m.lathe([[0.05, -0.078], [0.112, -0.078], [0.112, -0.073], [0.05, -0.073]], 28);
  // laced spokes
  const rr1 = R - 0.118;
  for (let i = 0; i < 32; i++) {
    const an = i / 32 * TAU, s = i & 1 ? 1 : -1, a2 = an + (i & 2 ? 0.42 : -0.42);
    m.tube([[s * 0.05, 0.048 * cos(an), 0.048 * sin(an)], [s * 0.012, rr1 * cos(a2), rr1 * sin(a2)]], 0.0028, 4);
  }
  return m.build();
}

// One section of a folding wing: hinge at the origin, running out along x (to the right for s = 1), leading edge
// toward +z. Made the way the bike is: a brushed-metal skin over frame-tube ribs, an exhaust-pipe leading edge,
// fender-plastic blades along the trailing edge, a hinge barrel at the root.
function wingSeg(s, len, c0, c1, tip) {
  const m = new Mesh(), sw = (c0 - c1) * 0.25;
  m.a = M_WING;
  m.loft([[s * 0.03, 0, 0], [s * len * 0.5, 0, -sw * 0.5], [s * len, 0, -sw]], (k) => [c0, (c0 + c1) / 2, c1][k], (k) => [0.05, 0.045, 0.034][k], 12, 2.3);
  m.a = M_STEEL;
  m.tube([[0, 0.004, c0 * 0.45], [s * len, 0.004, c1 * 0.45 - sw]], 0.021, 8);
  m.tube([[0, 0, -c0 * 0.4], [0, 0, c0 * 0.4]], 0.028, 10);                                       // hinge barrel
  m.a = M_FRAME;
  for (let i = 0; i <= 3; i++) { const t = i / 3, c = mix(c0, c1, t), x = s * (0.04 + (len - 0.08) * t); m.sweep([[x, 0, c * 0.47 - sw * t], [x, 0, -c * 0.43 - sw * t]], 0.018, 0.064); }
  m.a = M_PLASTIC;
  for (let i = 0; i < 3; i++) { const t = (i + 0.5) / 3, z = -mix(c0, c1, t) * 0.5 - sw * t; m.loft([[s * (len * i / 3 + 0.03), -0.004, z], [s * (len * (i + 1) / 3 - 0.03), -0.004, z]], 0.17, 0.012, 6, 3); }
  if (tip) { m.a = M_WHITE; m.loft([[s * (len - 0.03), 0, c1 * 0.35 - sw], [s * (len + 0.05), 0.07, -c1 * 0.35 - sw]], 0.028, 0.13, 8, 3); }   // winglet
  return m.build();
}

function buildBike() {
  const P = {};
  // wings: three sections a side that fold flat beside the rear wheel, and two tail fins on the rear fender
  for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
    P['wing' + n + '1'] = wingSeg(s, 0.8, 0.62, 0.58); P['wing' + n + '2'] = wingSeg(s, 0.9, 0.58, 0.5); P['wing' + n + '3'] = wingSeg(s, 0.8, 0.5, 0.26, true);
    P['fin' + n] = wingSeg(s, 0.42, 0.3, 0.16, true);
  }
  P.rudder = wingSeg(1, 0.52, 0.36, 0.2);
  // the lower wings: two shorter sections a side that swing out from beside the rear wheel, under the main pair
  for (const [s, n] of [[1, 'R'], [-1, 'L']]) { P['low' + n + '1'] = wingSeg(s, 0.7, 0.46, 0.42); P['low' + n + '2'] = wingSeg(s, 0.75, 0.42, 0.24, true); } // the tail fin: stood upright on the rear fender by the renderer, it swings like a rudder
  P.wheelF = buildWheel(BK.Rf, 0.095, false);
  P.wheelR = buildWheel(BK.Rr, 0.135, true);
  const AXR = [0, -BK.L + 0.07, -BK.b]; // rear axle at ride height

  // ================================================================ chassis
  let m = new Mesh();
  // ---- frame: twin spars from the steering head to the swingarm pivot, a down tube splitting into the cradle
  m.a = M_FRAME;
  for (const s of LR) {
    m.loft([[s * 0.035, 0.30, 0.42], [s * 0.085, 0.19, 0.16], [s * 0.105, 0.03, -0.08], [s * 0.105, -0.22, -0.14]], 0.03, (k) => [0.07, 0.065, 0.06, 0.05][k], 8, 3.5);
    m.tube([[0, -0.20, 0.29], [s * 0.09, -0.36, 0.06], [s * 0.10, -0.37, -0.08], [s * 0.105, -0.24, -0.15]], 0.018, 8);
  }
  m.tube([[0, 0.25, 0.43], [0, -0.20, 0.29]], 0.024, 8);
  m.loft([[0, -0.385, 0.22], [0, -0.40, 0.02], [0, -0.385, -0.12]], 0.22, 0.016, 8, 4);            // skid plate
  // radiators behind the shrouds, footpeg mounts
  for (const s of LR) { m.loft([[s * 0.115, 0.25, 0.27], [s * 0.115, 0.0, 0.335]], 0.03, 0.11, 8, 5); m.box(s * 0.145, -0.315, -0.10, 0.07, 0.03, 0.04); }
  // chain along the left side
  m.sweep([[-0.135, -0.165, -0.10], [-0.135, AXR[1] + 0.105, AXR[2]]], 0.012, 0.014);
  m.sweep([[-0.135, -0.245, -0.10], [-0.135, AXR[1] - 0.105, AXR[2]]], 0.012, 0.014);
  m.tube([[0, 0.39, 0.21], [0, 0.405, 0.21]], 0.034, 12);                                        // fuel cap
  // ---- subframe and swingarm
  m.a = M_ALU;
  for (const s of LR) {
    m.tube([[s * 0.09, 0.18, -0.08], [s * 0.085, 0.31, -0.74]], 0.014, 8);
    m.tube([[s * 0.10, -0.05, -0.18], [s * 0.085, 0.28, -0.68]], 0.012, 8);
    m.loft([[s * 0.105, -0.22, -0.14], [s * 0.118, (AXR[1] - 0.22) * 0.5 - 0.11, -0.45], [s * 0.125, AXR[1], AXR[2] - 0.03]], 0.034, (k) => [0.085, 0.075, 0.055][k], 8, 4);
    m.box(s * 0.215, -0.315, -0.10, 0.085, 0.022, 0.05);                                         // footpegs
  }
  m.loft([[0.17, 0.12, -0.40], [0.18, 0.18, -0.66], [0.188, 0.235, -0.90]], (k) => [0.075, 0.09, 0.085][k], (k) => [0.09, 0.115, 0.105][k], 12, 2.4); // silencer
  // ---- engine
  m.a = M_ENGINE;
  m.loft([[0, -0.26, -0.16], [0, -0.24, -0.02], [0, -0.22, 0.12], [0, -0.21, 0.2]], (k) => [0.2, 0.25, 0.25, 0.18][k], (k) => [0.16, 0.26, 0.26, 0.16][k], 12, 3);   // cases
  m.loft([[0, -0.12, 0.085], [0, 0.0, 0.118], [0, 0.10, 0.146]], 0.17, 0.165, 12, 4);                // cylinder
  for (let i = 0; i < 4; i++) { const t = i / 3; m.loft([[0, -0.085 + t * 0.15, 0.095 + t * 0.042], [0, -0.073 + t * 0.15, 0.098 + t * 0.042]], 0.2, 0.195, 12, 4); } // cooling fins
  m.tube([[0.125, -0.215, -0.02], [0.172, -0.215, -0.02]], 0.1, 18);                                 // clutch cover
  m.tube([[-0.125, -0.2, 0.06], [-0.158, -0.2, 0.06]], 0.075, 16);                                   // ignition cover
  m.a = M_FRAME;
  m.loft([[0, 0.105, 0.15], [0, 0.16, 0.165]], 0.185, 0.18, 12, 4);                                  // cylinder head cover
  m.tube([[0.172, -0.215, -0.02], [0.18, -0.215, -0.02]], 0.06, 14);
  m.tube([[0.188, 0.235, -0.90], [0.19, 0.245, -0.94]], 0.03, 10);                                   // silencer tip
  // ---- exhaust header: out of the front of the head, round the right side, back to the silencer
  m.a = M_STEEL;
  m.tube([[0.03, 0.08, 0.22], [0.09, 0.0, 0.31], [0.165, -0.13, 0.27], [0.19, -0.2, 0.1], [0.19, -0.12, -0.12], [0.175, 0.06, -0.3], [0.17, 0.12, -0.40]], (k) => [0.02, 0.022, 0.026, 0.034, 0.038, 0.032, 0.028][k], 10);
  m.a = M_SPRING;
  m.tube([[0, 0.14, -0.15], [0, -0.19, -0.27]], 0.038, 10);                                          // rear shock spring
  // ---- rocket boosters: a pod each side of the tail, built like a fat silencer with a nose cone and a bell nozzle
  for (const s of LR) {
    const x = s * NOZ[0], y = NOZ[1];
    m.a = M_ALU; m.tube([[x, y - 0.004, -0.72], [x, y, -1.08]], 0.056, 14);
    m.a = M_STEEL; for (const z of [-0.76, -0.9, -1.04]) m.tube([[x, y, z], [x, y, z - 0.018]], 0.06, 14);
    m.a = M_PLASTIC; m.tube([[x, y - 0.006, -0.6], [x, y - 0.005, -0.66], [x, y - 0.004, -0.72]], (k) => [0.008, 0.04, 0.056][k], 14);
    m.a = M_FRAME;
    m.tube([[x, y, -1.08], [x, y, -1.13], [x, y, NOZ[2]]], (k) => [0.034, 0.045, 0.072][k], 14);                    // bell
    m.tube([[s * 0.085, 0.31, -0.7], [x, y - 0.03, -0.8]], 0.012, 6); m.tube([[s * 0.085, 0.33, -0.74], [x, y - 0.03, -1.0]], 0.012, 6);   // mounts
    m.tube([[x - s * 0.03, y + 0.05, -0.74], [x - s * 0.035, y + 0.06, -0.9], [x - s * 0.02, y + 0.03, -1.07]], 0.007, 5);                 // fuel line
  }
  // ---- bodywork
  m.a = M_PLASTIC;
  m.loft([[0, 0.20, 0.40], [0, 0.305, 0.27], [0, 0.33, 0.12], [0, 0.305, 0.02]], (k) => [0.19, 0.29, 0.27, 0.2][k], (k) => [0.1, 0.15, 0.14, 0.08][k], 14, 2.6);   // tank
  for (const s of LR) {
    m.loft([[s * 0.15, 0.275, 0.06], [s * 0.18, 0.215, 0.22], [s * 0.2, 0.09, 0.39], [s * 0.19, 0.0, 0.46]], 0.024, (k) => [0.14, 0.24, 0.2, 0.06][k], 10, 2.6);     // radiator shrouds
  }
  m.loft([[0, 0.315, -0.55], [0, 0.385, -0.8], [0, 0.435, -1.0], [0, 0.445, -1.13]], (k) => [0.2, 0.2, 0.17, 0.09][k], (k) => [0.035, 0.03, 0.024, 0.016][k], 12, 3);   // rear fender
  m.a = M_WHITE;
  for (const s of LR) m.loft([[s * 0.137, 0.25, -0.2], [s * 0.132, 0.2, -0.44], [s * 0.115, 0.25, -0.7]], 0.02, (k) => [0.16, 0.23, 0.09][k], 10, 2.8);               // side number panels
  m.a = M_SEAT;
  m.loft([[0, 0.325, 0.09], [0, 0.34, -0.2], [0, 0.355, -0.5], [0, 0.375, -0.71]], (k) => [0.17, 0.2, 0.19, 0.13][k], (k) => [0.06, 0.085, 0.075, 0.045][k], 12, 3.2);
  P.chassis = m.build();

  // rocket flame: a cone one unit long pointing back from the origin, stretched each frame with the thrust
  m = new Mesh();
  m.a = M_FLAME;
  m.tube([[0, 0, 0.02], [0, 0, -0.3], [0, 0, -0.65], [0, 0, -1]], (k) => [0.055, 0.075, 0.05, 0.004][k], 12);
  P.flameR = m.build(); P.flameL = P.flameR;

  // ================================================================ rider
  // Posed every frame in main.js. Torso: origin at the pelvis, spine along +y. Helmet: origin at the top of the neck.
  // Limb segments are one unit long along z and get stretched between two joints; x is across, -y is the front.
  m = new Mesh();
  m.a = M_SUIT2;
  m.loft([[0, -0.02, 0], [0, 0.15, 0], [0, 0.31, 0], [0, 0.43, 0], [0, 0.48, 0]], (k) => [0.3, 0.34, 0.39, 0.36, 0.2][k], (k) => [0.2, 0.225, 0.23, 0.18, 0.12][k], 14, 2.4);
  for (const s of LR) m.blob(2, (x, y, z) => [s * 0.2 + x * 0.085, 0.425 + y * 0.08, z * 0.085]);
  m.a = M_PANTS;
  m.blob(2, (x, y, z) => [x * 0.19, y * 0.12, z * 0.15]);
  m.a = M_SUIT;
  m.tube([[0, 0.46, 0], [0, 0.575, 0.02]], 0.055, 10);                                             // neck
  m.a = M_FRAME;
  { const ring = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * TAU; ring.push([cos(a) * 0.105, 0.5 + sin(a) * 0.012, sin(a) * 0.1]); } m.tube(ring, 0.022, 8); } // neck brace
  P.torso = m.build();

  // helmet shell: longer front to back than wide, with the chin bar pushed forward
  m = new Mesh();
  m.a = M_WHITE;
  m.blob(3, (x, y, z) => {
    const chin = z > 0 && y < 0.05 ? sstep(0, 0.7, z) * sstep(0.05, -0.6, y) : 0, back = z < 0 ? 1.06 : 1;
    return [x * 0.122 * (1 - 0.12 * chin), 0.1 + y * (y > 0 ? 0.13 : 0.15), 0.04 + z * 0.148 * back * (1 + 0.42 * chin)];
  });
  m.a = M_PLASTIC;
  m.loft([[0, 0.192, 0.05], [0, 0.192, 0.18], [0, 0.174, 0.315]], (k) => [0.2, 0.19, 0.12][k], 0.016, 10, 3);      // peak
  m.loft([[0, 0.22, -0.09], [0, 0.215, 0.04]], 0.05, 0.02, 8, 3);                                         // top vent
  m.a = M_FRAME;
  m.loft([[0, 0.015, 0.202], [0, 0.015, 0.232]], 0.07, 0.035, 8, 4);                                      // mouth vent
  { const ring = []; for (let i = 0; i <= 14; i++) { const a = (i / 14 - 0.5) * 4.4 + PI; ring.push([sin(a) * 0.128, 0.112, 0.04 + cos(a) * 0.155]); } m.sweep(ring, 0.006, 0.04, null, false); } // goggle strap
  m.a = M_VISOR;
  m.loft([[-0.088, 0.11, 0.162], [-0.05, 0.112, 0.19], [0.05, 0.112, 0.19], [0.088, 0.11, 0.162]], 0.03, (k) => [0.06, 0.082, 0.082, 0.06][k], 10, 3);  // goggle lens
  P.helmet = m.build();

  const limb = (mat, w) => { const q = new Mesh(); q.a = mat; q.loft([[0, 0, 0], [0, 0, 0.5], [0, 0, 1]], (k) => w[k], (k) => w[k], 12); return q; };
  P.uarmL = limb(M_SLEEVE, [0.12, 0.11, 0.1]).build(); P.uarmR = P.uarmL;
  P.thighL = limb(M_PANTS, [0.18, 0.168, 0.14]).build(); P.thighR = P.thighL;
  // forearm, cuff toward the hand
  m = new Mesh();
  m.a = M_SUIT2;
  m.loft([[0, 0, 0], [0, 0, 0.3], [0, 0, 0.62], [0, 0, 0.86]], (k) => [0.092, 0.088, 0.076, 0.064][k], (k) => [0.092, 0.088, 0.076, 0.064][k], 12);
  P.armL = m.build(); P.armR = P.armL;
  // lower leg: tall boot from the knee down, knee guard and shin plate on the front, foot at the far end
  m = new Mesh();
  m.a = M_BOOT;
  m.loft([[0, 0, 0.04], [0, 0, 0.5], [0, 0, 0.97]], (k) => [0.125, 0.112, 0.1][k], (k) => [0.13, 0.125, 0.12][k], 12, 2.6);
  m.loft([[0, 0.07, 0.99], [0, -0.08, 1.02], [0, -0.21, 1.04]], (k) => [0.095, 0.105, 0.085][k], (k) => [0.2, 0.22, 0.15][k], 10, 3);
  m.a = M_WHITE;
  m.blob(2, (x, y, z) => [x * 0.08, -0.035 + y * 0.085, 0.02 + z * 0.2]);
  m.loft([[0, -0.066, 0.26], [0, -0.062, 0.66]], 0.07, 0.03, 8, 3);
  P.shinL = m.build(); P.shinR = P.shinL;

  // ================================================================ upper fork: stanchions, clamps, bars and controls, number plate, front fender
  m = new Mesh();
  m.a = M_STEEL;
  for (const s of LR) {
    m.tube([[s * 0.11, 0.37, 0.386], [s * 0.11, -0.08, 0.604]], 0.025, 12);
    // brake and clutch levers with their perches
    m.tube([[s * 0.245, 0.487, 0.372], [s * 0.252, 0.49, 0.402], [s * 0.31, 0.497, 0.404], [s * 0.39, 0.505, 0.39]], (k) => [0.007, 0.007, 0.006, 0.005][k], 6);
    m.box(s * 0.245, 0.487, 0.376, 0.03, 0.03, 0.036);
  }
  m.a = M_FRAME;
  m.loft([[0, 0.33, 0.36], [0, 0.33, 0.45]], 0.29, 0.034, 10, 4); m.loft([[0, 0.18, 0.434], [0, 0.18, 0.522]], 0.29, 0.034, 10, 4);      // triple clamps
  m.tube([[-0.39, 0.50, 0.33], [-0.3, 0.492, 0.35], [-0.15, 0.47, 0.38], [0.15, 0.47, 0.38], [0.3, 0.492, 0.35], [0.39, 0.50, 0.33]], 0.0125, 10);
  m.tube([[-0.15, 0.525, 0.372], [0.15, 0.525, 0.372]], 0.008, 8);
  for (const s of LR) { m.tube([[s * 0.15, 0.47, 0.38], [s * 0.15, 0.525, 0.372]], 0.008, 6); m.tube([[s * 0.05, 0.345, 0.405], [s * 0.05, 0.47, 0.38]], 0.016, 8); }
  m.tube([[0.26, 0.487, 0.36], [0.2, 0.4, 0.44], [0.14, 0.1, 0.56]], 0.005, 5);                    // brake hose
  // fork caps, clutch and throttle cables
  for (const s of LR) { m.tube([[s * 0.11, 0.368, 0.387], [s * 0.11, 0.39, 0.376]], 0.022, 10); m.tube([[s * 0.25, 0.49, 0.392], [s * 0.13, 0.43, 0.47], [s * 0.045, 0.31, 0.5]], 0.004, 5); }
  m.a = M_BOOT;
  for (const s of LR) {
    m.tube([[s * 0.285, 0.49, 0.35], [s * 0.4, 0.502, 0.328]], 0.0185, 12);                        // grips
    // gloves: palm on the grip, knuckles forward, thumb underneath
    m.blob(2, (x, y, z) => [s * GRIP[0] + x * 0.056, GRIP[1] + 0.012 + y * 0.042, GRIP[2] + 0.01 + z * 0.068]);
    m.loft([[s * (GRIP[0] - 0.035), GRIP[1] - 0.012, GRIP[2] - 0.01], [s * (GRIP[0] - 0.05), GRIP[1] - 0.03, GRIP[2] + 0.04]], 0.026, 0.026, 8);
    // four fingers curled over the grip
    for (let f = 0; f < 4; f++) { const fx = s * (GRIP[0] - 0.032 + f * 0.022); m.tube([[fx, GRIP[1] + 0.03, GRIP[2] - 0.012], [fx, GRIP[1] + 0.034, GRIP[2] + 0.03], [fx, GRIP[1] + 0.005, GRIP[2] + 0.052], [fx, GRIP[1] - 0.022, GRIP[2] + 0.035]], 0.0105, 6); }
  }
  m.a = M_FRAME;
  for (const s of LR) m.loft([[s * (GRIP[0] - 0.04), GRIP[1] + 0.047, GRIP[2] + 0.012], [s * (GRIP[0] + 0.04), GRIP[1] + 0.047, GRIP[2] + 0.012]], 0.03, 0.012, 8, 3);   // knuckle guards
  m.a = M_PLASTIC;
  for (const s of LR) m.loft([[s * 0.25, 0.492, 0.428], [s * 0.36, 0.5, 0.428], [s * 0.42, 0.505, 0.395], [s * 0.432, 0.506, 0.33]], 0.012, (k) => [0.05, 0.085, 0.085, 0.05][k], 8, 3);   // handguards
  m.loft([[-0.1, 0.527, 0.372], [0.1, 0.527, 0.372]], 0.05, 0.05, 10, 3);                               // crossbar pad
  m.loft([[0, 0.13, 0.44], [0, 0.185, 0.62], [0, 0.2, 0.82], [0, 0.155, 1.0], [0, 0.095, 1.11]], (k) => [0.12, 0.16, 0.175, 0.15, 0.07][k], (k) => [0.03, 0.026, 0.022, 0.02, 0.014][k], 12, 3);   // front fender
  m.a = M_WHITE;
  m.loft([[0, 0.405, 0.495], [0, 0.3, 0.548], [0, 0.195, 0.578]], (k) => [0.19, 0.225, 0.15][k], 0.022, 10, 3.2);    // number plate
  m.a = M_LAMP;
  m.tube([[0, 0.3, 0.556], [0, 0.297, 0.566]], 0.05, 16);                                                // headlight lens
  P.forkU = m.build();

  // ================================================================ lower fork: sliders, guards, axle, brake caliper (suspension fully out)
  m = new Mesh();
  for (const s of LR) {
    m.a = M_ALU; m.tube([[s * 0.11, AXF[1] - 0.03, AXF[2] + 0.015], [s * 0.11, AXF[1] + 0.45, AXF[2] - 0.218]], 0.033, 12);
    m.a = M_PLASTIC; m.loft([[s * 0.11, AXF[1] + 0.02, AXF[2] + 0.03], [s * 0.11, AXF[1] + 0.42, AXF[2] - 0.165]], 0.075, 0.02, 8, 3);
  }
  m.a = M_STEEL; m.tube([[-0.13, AXF[1], AXF[2]], [0.13, AXF[1], AXF[2]]], 0.012, 8);
  m.a = M_FRAME; m.box(0.082, AXF[1] + 0.085, AXF[2] - 0.06, 0.035, 0.06, 0.07);
  P.forkL = m.build();
  return P;
}
