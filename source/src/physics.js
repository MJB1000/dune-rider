// ============================================================================
// the bike: a rigid body on two sprung wheels, stepped at 240 Hz. No allocations.
// Axes: x right, y up, z forward (at yaw 0). yaw+ turns right, pitch+ lifts the nose, lean+ tips to the right.
// ============================================================================
const BK = {
  m: 195, Ip: 62, Iy: 46,          // mass (bike + rider), pitch and yaw inertia
  a: 0.72, b: 0.76,                // CoM to front / rear axle along the bike
  L: 0.40, travel: 0.30,           // CoM to axle (suspension fully out), suspension travel
  Rf: 0.35, Rr: 0.33,              // wheel radii
  k: 11500, k2: 90000, c: 1350,    // spring, bottom-out spring, damper
  Fmax: 1500, P: 27000,            // peak drive force (N) and power (W)
  rocket: 2000, ram: 30, rocketMax: 4000, burn: 3, recharge: 15, // booster: thrust at rest (N), extra per m/s of airspeed, ceiling, seconds of burn in a full tank, seconds to refill it on the ground (three times as long in the air)
  gmax: 2.7, hard: 26, softK: 1,   // what the upgrades change: g the wing tips take before folding, landing speed the bike survives (m/s), how much loose sand slows it
  reb: 2.4,                        // the dampers resist coming back out this much harder than going in, so a landing stays down
  wingS: 5.5,                      // wing area (m2) when the wings are out
  mu: 0.95, muLat: 0.85, cLat: 2100, crr: 0.055, drag: 0.36, brake: 1100,
};
// state
const B = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: PI / 2, pitch: 0, q: 0, r: 0,
  lean: 0, steer: 0, cF: 0, cR: 0, spinF: 0, spinR: 0, wR: 0,
  gF: 0, gR: 0, slip: 0, speed: 0, vlong: 0, air: 0, crash: 0, land: 0, thr: 0, cut: 0, hard: 0, wing: 0, wingOn: 0, alpha: 0, fuel: 1, bst: 0, armed: 1, wp: 0, wr: 0, trim: 0, wdep: 0, tk: 0, sf: 0,
  ps: 0, pre: 0, soft: 0, stl: 0, ovl: 0, folded: 0, fold: 0, ft: 0, turb: 0, ge: 0, // power slide, jump preload, softness of the sand under the wheels, stall (signed: which wing dropped), overload timer, wing tips folded (flag, eased, recovery timer), rough air, ground effect
  ct: 0, lift: 0, flap: 0, flapOn: 0, // time since the crash began, rising air under the wings (m/s), lower wings out 0..1 and asked for
  lq: 0, lrel: 0, bury: 0, hi: 0, // how the last landing went (0 none, 1 heavy, 2 clean, 3 perfect), nose above the slope when it touched (rad), how deep the wheels are buried, how far into the rough high air
  wy: 0, yh: 0, rot: 0, flips: 0, free: 0, imp: 0, bog: 0, // rudder, heading hold, pitch turned through this airtime, flips landed, flip armed, impact speed, landing bog
};
// input: throttle 0..1, brake 0..1, steer -1..1
const IN = { thr: 0, brk: 0, steer: 0, boost: 0, yaw: 0, lean: 0, tuck: 0 }; // tuck: wings pulled in for a dive (F held); // lean: rider's weight, +1 forward, -1 back

function resetBike(x, z, yaw) {
  B.x = x; B.z = z; B.y = heightAt(x, z) + BK.L + BK.Rr + 0.05; B.vx = B.vy = B.vz = 0; B.yaw = yaw; B.pitch = 0; B.q = B.r = 0;
  B.lean = B.steer = 0; B.cF = B.cR = 0; B.wR = 0; B.crash = 0; B.air = 0; B.land = 0; B.cut = 0; B.hard = 0; B.wing = 0; B.wingOn = 0; B.fuel = 1; B.bst = 0; B.armed = 1; B.wp = 0; B.wr = 0; B.wdep = 0; B.tk = 0; B.sf = 0;
  B.ct = 0; B.lift = 0; B.flap = 0; B.flapOn = 0; B.ps = 0; B.pre = 0; B.soft = 0; B.stl = 0; B.ovl = 0; B.folded = 0; B.fold = 0; B.ft = 0; B.turb = 0; B.ge = 0;
  B.wy = 0; B.yh = 0; B.rot = 0; B.flips = 0; B.free = 0; B.imp = 0; B.bog = 0; B.lq = 0; B.lrel = 0; B.bury = 0; B.hi = 0;
}

// ---- the air itself. A steady wind blows toward +x: it is pushed up the windward faces of the dunes (ridge lift) and
// tumbles down behind them (sink). By day the sun heats the sand and columns of warm air rise from it (thermals):
// one in about half of the 256 m squares of the field, 70 to 120 m in radius (wide enough to circle in), leaning downwind as they climb, topping out
// about 600 m up. Only the wings feel any of this.
const THN = 8, THC = TILE / THN, THERM = new Float32Array(THN * THN * 4), WIND = 13; // per square: x, z, radius, strength in m/s (0 = none)
{
  let s = 977 + WS; const r = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < THN * THN; i++) { const on = r() < 0.7; THERM[i * 4] = ((i % THN) + 0.2 + 0.6 * r()) * THC; THERM[i * 4 + 1] = (floor(i / THN) + 0.2 + 0.6 * r()) * THC; THERM[i * 4 + 2] = 90 + 60 * r(); THERM[i * 4 + 3] = on ? 5 + 4 * r() : 0; }
}
let STILL = 0; // the simulations set this for still air, so their numbers are about the bike and not the weather
let _hag = 0, _gst = 0, _turb = 0, _T = 0, _hi = 0; // height above the ground, sideways gust, how rough the air is, the clock the gusts run on
function airUp(x, y, z) {
  const hag = max(y - heightAt(x, z), 0); _hag = hag; _gst = 0; _turb = 0; _hi = 0;
  if (STILL) return 0;
  const rl = clamp(1.25 * WIND * (heightAt(x + 40, z) - heightAt(x - 40, z)) / 80, -3, 9) * exp(-hag / 110);
  let w = rl, edge = 0;
  const day = sstep(0.05, 0.5, SUN[1]);
  if (day > 0) {
    const ci = floor(x / THC), cj = floor(z / THC), top = sstep(2, 20, hag) * (1 - sstep(500, 700, hag)) * day;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const k = ((i & 7) + (j & 7) * THN) * 4, S = THERM[k + 3]; if (!S) continue;
      const dx = x - THERM[k] - (i - (i & 7)) * THC - hag * 0.12, dz = z - THERM[k + 1] - (j - (j & 7)) * THC, d2 = (dx * dx + dz * dz) / (THERM[k + 2] * THERM[k + 2]);
      if (d2 < 6) { const e = S * exp(-d2) * top; w += e; edge += e * d2; } // (the edge of a thermal, where rising air shears against still air, is the rough part)
    }
  }
  // gusts: the air is never quite steady, and it is rough in the tumbling air behind a crest and at the edge of a thermal
  // high up the air is another thing altogether: above about 150 m it gets rougher with every metre, and by 500 m it throws the bike about
  const hi = sstep(150, 500, hag); _hi = hi;
  const T = (0.25 + max(-rl, 0) * 0.6 + edge * 0.35) * (1 + 5 * hi) + 1.2 * hi;
  _turb = T; _gst = sin(_T * 1.7 + z * 0.06 + 1.3) * sin(_T * 3.1 + x * 0.03) * T;
  return w + (sin(_T * 2.3 + x * 0.05) * sin(_T * 1.3 + z * 0.04) + 0.5 * sin(_T * 5.9 + x * 0.11 + z * 0.07)) * T * 1.2;
}

// ---- a crash. The rider is thrown clear and tumbles; the bike slides and spins on its side. Both are single bodies
// that bounce, slide and plough through the sand until they stop, or roll on down a slope steep enough to carry them.
const RD = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, a: 0, w: 0, yaw: 0, bones: 0, dist: 0, hit: 0, still: 0 };
// returns -1 in the air, otherwise how hard the body hit the ground this step (m/s)
function slideBody(o, dt, rad, mu) {
  o.vy -= 9.81 * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
  const h = heightAt(o.x, o.z) + rad;
  if (o.y >= h) return -1;
  o.y = h; groundNormal(o.x, o.z);
  const nx = _gn[0], ny = _gn[1], nz = _gn[2], vn = o.vx * nx + o.vy * ny + o.vz * nz; let hit = 0;
  if (vn < 0) { hit = -vn; const j = vn * (vn < -2.5 ? 1.3 : 1); o.vx -= nx * j; o.vy -= ny * j; o.vz -= nz * j; }
  const sp = hypot(o.vx, o.vy, o.vz);
  if (sp > 1e-3) { const f = max(0, 1 - (mu * 9.81 + 0.5 * sp) * dt / sp); o.vx *= f; o.vy *= f; o.vz *= f; }
  return hit;
}
function startCrash() {
  const sy = sin(B.yaw), cy = cos(B.yaw);
  B.hard = 0; B.wingOn = 0; B.flapOn = 0; B.crash = 1; B.ct = 0;
  RD.x = B.x; RD.y = B.y + 0.6; RD.z = B.z; RD.vx = B.vx + sy * 2; RD.vy = 2.5 + B.speed * 0.06; RD.vz = B.vz + cy * 2;
  RD.a = 0; RD.w = 3 + B.speed * 0.25; RD.yaw = B.yaw; RD.bones = max(1, round(B.speed / 9)); RD.dist = 0; RD.hit = min(1.5, 0.4 + B.speed / 20); RD.still = 0;
  B.vx *= 0.7; B.vz *= 0.7; B.vy = 1.5; B.r = (B.lean < 0 ? -1 : 1) * (1 + B.speed * 0.08); B.q = 0;
}
function stepCrash(dt) {
  B.ct += dt;
  let h = slideBody(RD, dt, 0.28, 0.55);
  const sp = hypot(RD.vx, RD.vy, RD.vz);
  if (h >= 0) {
    if (h > 3) { RD.bones += floor(h / 3); RD.hit = max(RD.hit, min(1.5, h / 9)); }
    RD.w += (sp / 0.45 - RD.w) * min(1, dt * 8);
    // coming to rest, he ends up flat on his front or his back rather than balanced on his head
    if (sp < 2.5) { RD.w = 0; RD.a += (round(RD.a / PI) * PI - RD.a) * min(1, dt * 5); }
  }
  RD.a += RD.w * dt; RD.dist += hypot(RD.vx, RD.vz) * dt;
  if (hypot(RD.vx, RD.vz) > 1.5) RD.yaw = Math.atan2(RD.vx, RD.vz);
  h = slideBody(B, dt, 0.36, 0.7); B.yaw += B.r * dt; B.r *= exp(-dt * (h >= 0 ? 1.8 : 0.2));
  if (h >= 0) {
    groundNormal(B.x, B.z);
    B.pitch += (Math.asin(clamp(-(_gn[0] * sin(B.yaw) + _gn[2] * cos(B.yaw)), -1, 1)) - B.pitch) * min(1, dt * 6);
    if (h > 3) RD.hit = max(RD.hit, min(1, h / 12));
  }
  B.speed = hypot(B.vx, B.vy, B.vz); B.gF = B.gR = 0; B.bst *= exp(-dt * 14); B.wing = max(0, B.wing - dt * 2.5); B.wdep = max(0, B.wdep - dt * 2); B.flap = max(0, B.flap - dt * 2);
  RD.still = sp < 1.2 ? RD.still + dt : 0;
  if ((B.ct > 1.6 && RD.still > 0.6 && B.speed < 1.5) || B.ct > 7) { B.crash = 0; resetBike(B.x, B.z, B.yaw); }
}

// accumulators for one step
let _fx, _fy, _fz, _tp, _ty;
// one wheel: zw = position along the bike, R = radius, st = steering angle, drive = requested drive force along the wheel, brk = brake force
// returns suspension compression; sets _wg (normal load) and _ws (fraction of the requested drive that the sand could not take)
let _wg = 0, _ws = 0, _lat = 1, _soft = 0; // _lat: sideways grip scale for the wheel about to be stepped; _soft: softest sand under either wheel this step
function wheel(zw, R, st, drive, brk, fX, fY, fZ, uX, uY, uZ, rX, rZ) {
  const k = BK, ax = B.x + fX * zw - uX * k.L, ay = B.y + fY * zw - uY * k.L, az = B.z + fZ * zw - uZ * k.L;
  const pen = heightAt(ax, az) + R - ay;
  _wg = 0; _ws = 0;
  if (pen <= 0) return 0;
  groundNormal(ax, az);
  const nx = _gn[0], ny = _gn[1], nz = _gn[2];
  const comp = min(pen / max(uY, 0.35), k.travel + 0.12);
  // velocity of the axle: body velocity + pitch and yaw rotation
  const pvx = B.vx + B.q * (zw * uX + k.L * fX) + B.r * zw * rX, pvy = B.vy + B.q * (zw * uY + k.L * fY), pvz = B.vz + B.q * (zw * uZ + k.L * fZ) + B.r * zw * rZ;
  const vn = pvx * nx + pvy * ny + pvz * nz;
  // the sand is not all the same: lee faces are loose avalanche sand that swallows the wheel and gives little to push
  // against, windward faces are a wind-packed crust that rolls easy and grips, pans and ramps are hardpack
  const pack = RMK[(round(ax * 0.5) & HM) + (round(az * 0.5) & HM) * HN], lee = nx / max(ny, 0.3), soft = sstep(0.2, 0.5, lee) * (1 - pack) * k.softK, firm = lee < -0.05 ? 1 - pack : 0, grip = (1 - 0.22 * soft) * (1 + 0.1 * firm);
  if (soft > _soft) _soft = soft;
  if (vn < -k.hard * (1 + 0.35 * soft) && B.air > 0.3) B.hard = 1; // (loose sand forgives a harder hit) // came down flat from too high
  if (B.air > 0.2 && -vn > B.imp) B.imp = -vn; // how hard this landing hit
  let Fs = k.k * comp + (comp > k.travel ? k.k2 * (comp - k.travel) : 0) - k.c * (vn > 0 ? k.reb : 1) * vn;
  if (Fs < 0) Fs = 0; else if (Fs > 30000) Fs = 30000;
  // ground tangents: along the bike and to its right
  let d = fX * nx + fY * ny + fZ * nz, tx = fX - nx * d, ty = fY - ny * d, tz = fZ - nz * d, l = 1 / (hypot(tx, ty, tz) || 1); tx *= l; ty *= l; tz *= l;
  d = rX * nx + rZ * nz; let sx = rX - nx * d, sy = -ny * d, sz = rZ - nz * d; l = 1 / (hypot(sx, sy, sz) || 1); sx *= l; sy *= l; sz *= l;
  // wheel heading and its sideways axis (front wheel is steered)
  const cs = cos(st), sn = sin(st), hx = tx * cs + sx * sn, hy = ty * cs + sy * sn, hz = tz * cs + sz * sn, lx = sx * cs - tx * sn, ly = sy * cs - ty * sn, lz = sz * cs - tz * sn;
  const vl = pvx * hx + pvy * hy + pvz * hz, vs = pvx * lx + pvy * ly + pvz * lz;
  // along the wheel: drive, brake, rolling resistance of soft sand; limited by grip
  // packed sand (ramps and pans) drags far less than soft sand
  const roll = clamp(vl * 2, -1, 1);
  let Fl = drive - (brk + min(0.6, k.crr * (1 - 0.6 * pack) * (1 + 3.2 * soft) * (1 - 0.3 * firm) * (1 + 3 * B.bog) * (1 + 2.5 * B.bury)) * Fs) * roll; // (a wheel that has just landed is dug in)
  const lim = k.mu * Fs * grip;
  if (drive > lim) _ws = (drive - lim) / drive;
  Fl = clamp(Fl, -lim, lim);
  // sideways: the tyre resists sliding until it lets go
  const gq = k.muLat * Fs * grip * _lat, Fq = clamp(-vs * k.cLat, -gq, gq);
  const Fx = nx * Fs + hx * Fl + lx * Fq, Fy = ny * Fs + hy * Fl + ly * Fq, Fz = nz * Fs + hz * Fl + lz * Fq;
  _fx += Fx; _fy += Fy; _fz += Fz;
  // torque about the CoM from this contact point
  const h = k.L - comp + R, cx = fX * zw - uX * h, cy = fY * zw - uY * h, cz = fZ * zw - uZ * h;
  const qx = cy * Fz - cz * Fy, qy = cz * Fx - cx * Fz, qz = cx * Fy - cy * Fx;
  _tp -= qx * rX + qz * rZ; _ty += qy;
  _wg = Fs;
  return min(comp, k.travel);
}

function stepBike(dt) {
  const k = BK;
  if (B.crash > 0) { stepCrash(dt); return; }
  const sy = sin(B.yaw), cy = cos(B.yaw), sp = sin(B.pitch), cp = cos(B.pitch);
  const fX = sy * cp, fY = sp, fZ = cy * cp, uX = -sy * sp, uY = cp, uZ = -cy * sp, rX = cy, rZ = -sy;
  const vlong = B.vx * fX + B.vy * fY + B.vz * fZ, spd = hypot(B.vx, B.vy, B.vz);
  // steering: full input asks for the tightest turn the tyres can hold at this speed rather than a fixed angle,
  // and the rider steers against any turning he did not ask for, which is what catches a slide.
  // It returns to centre faster than it goes on.
  const av = max(abs(vlong), 2), lock = min(0.52, 10.5 / (av * av) + 0.004), wasDown = B.gF > 0 || B.gR > 0;
  // power slide: throttle and brake together in a turn. The rider stops easing the throttle and stops catching the
  // slide, the rear tyre gives up most of its sideways grip to the spinning wheel, and the back steps out and steers the bike.
  B.ps += clamp((IN.thr > 0.5 && IN.brk > 0.5 && abs(IN.steer) > 0.3 && vlong > 5 && wasDown ? 1 : 0) - B.ps, -dt * 4, dt * 5);
  const rWant = IN.steer * min(av * lock / (k.a + k.b), 8.3 / av) * (1 + 0.7 * B.ps), rErr = rWant - B.r;
  const catchS = wasDown && vlong > 3 && (abs(B.r) > abs(rWant) || B.r * rWant < 0) ? clamp(rErr * 0.15, -0.2, 0.2) * (1 - 0.7 * B.ps) : 0;
  const stT = clamp(IN.steer * lock + catchS, -0.52, 0.52);
  B.steer += (stT - B.steer) * min(1, dt * (abs(stT) < abs(B.steer) ? 16 : 10));
  B.sf += (abs(IN.steer) - B.sf) * min(1, dt * 6);
  B.thr += (IN.thr - B.thr) * min(1, dt * 12);
  _fx = 0; _fy = -k.m * 9.81; _fz = 0; _tp = 0; _ty = 0;
  // the rider rolls off the throttle as the front comes up, and eases it in a turn so the front tyre keeps its bite
  const drive = B.thr * (1 - B.cut) * (1 - 0.6 * B.bog) * (1 - 0.45 * B.bury) * (1 - 0.4 * B.sf * sstep(4, 9, vlong) * (1 - B.ps)) * min(k.Fmax, k.P / max(vlong, 1));
  _soft = 0; _lat = 1 - 0.72 * B.ps; _T += dt;
  B.cR = wheel(-k.b, k.Rr, 0, drive, IN.brk * k.brake * 0.45 * (1 - B.ps), fX, fY, fZ, uX, uY, uZ, rX, rZ); B.gR = _wg; B.slip = max(_ws, B.ps * 0.7);
  _lat = 1;
  B.cF = wheel(k.a, k.Rf, B.steer, 0, IN.brk * k.brake * (1 - B.ps), fX, fY, fZ, uX, uY, uZ, rX, rZ); B.gF = _wg;
  B.soft += (_soft - B.soft) * min(1, dt * 8);
  const grounded = B.gR > 0 || B.gF > 0;
  // air drag
  // (the rider tucks in behind the bars when gliding)
  const kd = k.drag * (1 - 0.4 * B.wdep);
  _fx -= kd * spd * B.vx; _fy -= kd * spd * B.vy; _fz -= kd * spd * B.vz;
  if (!grounded) {
    // in the air the rear wheel is a reaction wheel: throttle lifts the nose, brake drops it
    // and the rider's body english eases the bike toward its flight path for the landing
    const want = clamp(Math.atan2(B.vy, hypot(B.vx, B.vz) + 3) * 0.6, -0.5, 0.5);
    let dp = want - B.pitch; dp -= round(dp / TAU) * TAU;
    // flips. High enough off the ground, with the throttle and brake let go once since take-off, they stop being a
    // nudge and become a rotation: throttle throws the bike over backward, brake forward, about one turn in 1.2 s.
    // Hands off, the rider pulls it level the short way round. Once the bike is well over it keeps this authority
    // whatever the height, so a flip started high can be finished low.
    if (!IN.thr && !IN.brk) B.free = 1;
    const inp = IN.thr - IN.brk, fl = B.free * (1 - B.wdep) * max(sstep(4, 7, B.y - heightAt(B.x, B.z)), sstep(0.8, 1.2, abs(dp)));
    // weight forward as the bike leaves the ground soaks up the lip: less height, nose held down
    if (B.air === 0 && IN.lean > 0 && B.vy > 1) B.vy *= 1 - 0.28 * IN.lean;
    B.pre = 0;
    _tp += mix(B.thr * 1.0 - IN.brk * 1.8 - IN.lean * 0.8 + dp * 3.5 - B.q * 2.2, inp ? (inp * 5.5 - B.q) * 7 : (dp - IN.lean * 0.4) * 14 - B.q * 6, fl) * k.Ip * (1 - B.wing);
    B.rot += B.q * dt;
    // steering whips the bike round in the air; hands off, it swings back to face the way it is travelling, ready to land.
    // The tail fin (Q and E) turns it flat and slowly, like a helicopter's pedals, and the heading it is left on is held for a moment.
    let ya = Math.atan2(B.vx, B.vz) - B.yaw; ya -= round(ya / TAU) * TAU;
    if (abs(B.wy) > 0.05) B.yh = 1; else B.yh = max(0, B.yh - dt * 0.7);
    _ty += (IN.steer * 1.5 + B.wy * 1.1 - B.r * 1.2 + (hypot(B.vx, B.vz) > 4 ? clamp(ya, -0.6, 0.6) * 3 * (1 - abs(IN.steer)) * (1 - B.yh) : 0)) * k.Iy * (1 - B.wing);
    B.air += dt; B.cut = 0;
  } else {
    // touchdown: how hard it hit sets the thump, the dust and the bog. The sand takes a bite out of the speed,
    // the engine labours for a moment and the dug-in tyres drag, so the bike arrives rather than skips.
    if (B.air > 0.35) {
      // How it lands is graded. Come down a slope that falls away at the angle the bike is falling, with the wheels
      // lined up to it and pointing the way it is going, and the ground takes almost nothing: the speed is kept.
      // Land flat, nose-high or crabbed and the sand takes its bite. Loose sand swallows the wheels to the axles.
      groundNormal(B.x, B.z);
      const lr = B.pitch - Math.asin(clamp(-(_gn[0] * sy + _gn[2] * cy), -1, 1)); let yv = hypot(B.vx, B.vz) > 3 ? Math.atan2(B.vx, B.vz) - B.yaw : 0; yv -= round(yv / TAU) * TAU;
      const bad = max(B.imp / 7, max(abs(lr) / 0.16, abs(yv) / 0.22));
      B.lrel = lr; B.lq = B.air < 0.8 ? 0 : bad < 1 ? 3 : bad < 2 ? 2 : 1;
      B.land = clamp(B.imp / 9, 0.2, 1.5) * (B.lq === 3 ? 0.5 : 1); B.bog = min(1, B.land) * (B.lq === 3 ? 0.15 : B.lq === 2 ? 0.6 : 1);
      B.bury = max(B.bury, _soft * clamp(B.imp / 7, 0.3, 1) * (B.lq === 3 ? 0.4 : 1));
      const sc = 1 - 0.06 * B.bog - 0.22 * B.bury; B.vx *= sc; B.vz *= sc;
      B.flips = floor(abs(B.rot) / TAU + 0.2) * (B.rot > 0 ? 1 : -1);
    }
    B.air = 0; B.imp = 0; B.rot = 0; B.free = 0; B.yh = 0;
    // the rider keeps a looping wheelie from going all the way over
    groundNormal(B.x, B.z);
    const rel = B.pitch - Math.asin(clamp(_gn[0] * -sy + _gn[2] * -cy, -1, 1)), over = rel - 0.6;
    B.cut = B.gF === 0 ? clamp((rel - 0.3) / 0.3, 0, 1) : 0;
    if (over > 0 && B.gF === 0) _tp -= over * 2400 + max(B.q, 0) * 320;
    // at walking pace the rider can foot-pivot the bike round
    // rider weight: forward loads the front tyre, back unloads it and loads the rear. Held back, he also crouches and
    // winds up the suspension; letting go springs the bike off the ground, which on a lip is extra height.
    _tp -= IN.lean * 240;
    if (IN.lean < -0.3) B.pre = min(1, B.pre + dt * 2.5); else { if (B.pre > 0.15) { B.vy += 2.6 * B.pre; B.q += 0.5 * B.pre; } B.pre = 0; }
    // in a power slide he kicks the tail out and holds it about twenty-five degrees off the direction of travel
    if (B.ps > 0) _ty += B.ps * (IN.steer * 3.2 - Math.atan2(B.vx * rX + B.vz * rZ, max(vlong, 1)) * -8 - B.r * 1.5) * k.Iy;
    if (abs(vlong) < 2.5) _ty += IN.steer * 2.2 * k.Iy * (1 - abs(vlong) / 2.5);
    // turning, he slides forward on the seat to load the front wheel
    _tp -= 200 * B.sf;
  }
  // ---- rocket boosters: thrust straight along the bike
  // A tank holds three seconds of burn and takes fifteen to refill, on the ground or in the air. Hold the button
  // to burn, let go to save the rest. Run it dry and it will not relight until the button has been let go.
  const burning = IN.boost && B.armed && B.fuel > 0 && B.crash <= 0 ? 1 : 0;
  if (burning) { B.fuel -= dt / k.burn; if (B.fuel <= 0) { B.fuel = 0; B.armed = 0; } }
  else { B.fuel = min(1, B.fuel + dt / k.recharge * (grounded ? 1 : 0.33)); if (!IN.boost || B.fuel >= 1) B.armed = 1; }
  B.bst += (burning - B.bst) * min(1, dt * 14);
  // the boosters breathe rammed air: the faster the bike is moving when they are lit, the harder they push.
  // So speed built on a flat, or in a stoop with the wings pulled in, is what makes a burn worth having.
  const thrust = min(k.rocket + k.ram * spd, k.rocketMax) * B.bst;
  _fx += fX * thrust; _fy += fY * thrust; _fz += fZ * thrust;
  B.bog *= exp(-dt * 3.5); B.bury *= exp(-dt * (0.5 + 1.6 * B.thr)); // (buried wheels are dug out with the throttle) B.wy += clamp((grounded ? 0 : IN.yaw) - B.wy, -dt * 4, dt * 4);
  // ---- wings: they take about half a second to fold out or away
  // Like a falcon: with the wings out, holding F (IN.tuck) pulls them most of the way in (a stoop: little lift,
  // little drag, the nose drops and speed builds); letting go spreads them and the speed turns back into lift.
  // B.wdep is whether the wings are unfolded at all, B.tk how far they are tucked, B.wing how much wing is in the air.
  B.wdep += clamp((B.wingOn ? 1 : 0) - B.wdep, -dt * 2, dt * 2);
  B.tk += clamp((B.wingOn && B.air > 0.7 ? IN.tuck : 0) - B.tk, -dt * 2.5, dt * 2.5); // (not in the first moment off a ramp or a runway, when the throttle is still open from the ground)
  B.wing += clamp(B.wdep * (1 - 0.75 * B.tk) - B.wing, -dt * 2.5, dt * 2.5);
  B.flap += clamp((B.flapOn ? B.wdep : 0) - B.flap, -dt * 2, dt * 2); // the lower pair of wings
  B.lift = 0; B.turb = 0; B.ge = 0;
  if (B.wing <= 0.02) { B.folded = 0; B.ovl = 0; B.stl = 0; }
  B.fold += clamp(B.folded - B.fold, -dt * 2, dt * 4);
  if (B.wing > 0.02 && spd > 3) {
    // the wings fly through the air, not over the ground: rising air comes at them from below
    B.lift = airUp(B.x, B.y, B.z);
    const avy = B.vy - B.lift, as = hypot(B.vx, avy, B.vz);
    // the controls ease toward what is asked rather than snapping, so a tap is a nudge and a hold is full deflection
    B.wp += clamp(IN.brk - IN.tuck * 0.9 - B.wp, -dt * 2.4, dt * 2.4); B.wr += clamp(IN.steer - B.wr, -dt * 2.6, dt * 2.6);
    // the lower wings add six tenths as much area again, and their own drag
    const w = B.wing, qd = 0.6 * as * as, ivx = B.vx / as, ivy = avy / as, ivz = B.vz / as, S = k.wingS * w * (1 + 0.6 * B.flap) * (1 - 0.4 * B.fold), cd0 = 0.035 + 0.03 * B.flap;
    // ground effect: within a wingspan of the sand the air is squeezed under the wings, so they lift more and drag less for it
    const ge = clamp(1 - max(_hag - 0.4, 0) / 5.5, 0, 1), ge2 = ge * ge, ki = 0.05 * (1 - 0.5 * ge2);
    B.ge = ge2; B.turb = _turb;
    // angle of attack: how far the nose points above the flight path (the wings sit at a slight angle on the bike)
    const vf = ivx * fX + ivy * fY + ivz * fZ, vu = ivx * uX + ivy * uY + ivz * uZ, alpha = Math.atan2(-vu, max(vf, 0.05)) + 0.06 + _gst * 0.03, aS = 0.32 - 0.12 * _hi; // (high up the wings let go sooner, and the gusts tip them past it)
    B.hi = _hi;
    // lift rises with the angle until the wing stalls; drag is the wing's own plus what making lift costs
    let cl = clamp(4.4 * alpha, -0.5, 1.35) * (1 + 0.22 * ge2), cd = cd0 + cl * cl * ki;
    if (alpha > aS) { cl *= max(0.45, 1 - (alpha - aS) * 3); cd += (alpha - aS) * 1.5; }
    // stall: past that angle the wings let go, and never both at once. One drops, the bike rolls and yaws toward it and
    // the nose falls. It flies again once the angle is back under control, which means letting the nose go down.
    if (alpha > aS && !grounded) { if (!B.stl) B.stl = B.lean < 0 || (B.lean === 0 && B.r < 0) ? -0.05 : 0.05; B.stl = clamp(B.stl + (B.stl > 0 ? 1 : -1) * dt * 1.4 * (1 + 1.5 * _hi), -1, 1); }
    else if (B.stl) { const n = abs(B.stl) - dt * 1.5; B.stl = n > 0 ? (B.stl > 0 ? n : -n) : 0; }
    // wing loading: ask the wings for more than about 2.7 g for half a second and the tip sections fold back.
    // They stay folded, with four tenths of the wing gone, until the bike has been slow and gentle for a second.
    const nRaw = qd * S * cl / (k.m * 9.81);
    B.ovl = nRaw > k.gmax ? B.ovl + dt : max(0, B.ovl - dt * 2); if (B.ovl > 0.5) B.folded = 1;
    if (B.folded && as < 33 && nRaw < 2) { B.ft += dt; if (B.ft > 1) { B.folded = 0; B.ft = 0; B.ovl = 0; } } else B.ft = 0;
    // the wings give rather than pull more than about three g, so a fast pull-out is a long clean arc, not a wall of drag
    const clG = 3.2 * k.m * 9.81 / (qd * S); if (cl > clG) { cl = clG; cd = cd0 + cl * cl * ki; }
    const Lf = qd * S * cl, Df = qd * S * cd;
    // lift acts square to the flight path, tilted with the bank
    const cb = cos(B.lean), sb = sin(B.lean); let lx = uX * cb + rX * sb, ly = uY * cb, lz = uZ * cb + rZ * sb;
    const dd = lx * ivx + ly * ivy + lz * ivz; lx -= ivx * dd; ly -= ivy * dd; lz -= ivz * dd; const ll = 1 / (hypot(lx, ly, lz) || 1);
    _fx += lx * ll * Lf - ivx * Df; _fy += ly * ll * Lf - ivy * Df; _fz += lz * ll * Lf - ivz * Df;
    // flying a little sideways, the fin and the bike's flank push back across the airflow: that is what turns a rudder input into a flat turn
    const vr = ivx * rX + ivz * rZ, Sf = -qd * 3 * vr * B.wdep; _fx += rX * Sf; _fz += rZ * Sf;
    B.alpha = alpha;
    if (!grounded) {
      // the tail holds the nose near the flight path: brake pulls up (flare), tucking pushes over (dive)
      const auth = min(1, qd / 220) * w;
      _tp += ((0.14 + B.trim + 0.18 * B.wp - alpha + 0.06) * 10 - B.q * 4.5) * k.Ip * auth - abs(B.stl) * 1.6 * k.Ip * w;
      // and the bike weathervanes to face where it is going
      let dy = Math.atan2(B.vx, B.vz) - B.yaw; dy -= round(dy / TAU) * TAU;
      _ty += ((dy + B.wy * 0.45) * 7 - B.r * 3.5 + _gst * 0.9) * k.Iy * auth + B.stl * 1.2 * k.Iy * w; // (the rudder holds the nose off to one side; gusts shove it about)
    } else _tp += ((0.2 + B.trim - alpha) * 60 - B.q * 8) * k.Ip * min(1, qd / 220) * w * sstep(18, 24, spd) * B.bst; // on the ground, under rocket power, the tail lifts the nose once there is speed enough to fly: a flat is a runway
  }
  B.vx += _fx / k.m * dt; B.vy += _fy / k.m * dt; B.vz += _fz / k.m * dt;
  B.q += _tp / k.Ip * dt; B.r += _ty / k.Iy * dt;
  const damp = exp(-dt * (grounded ? 1.2 : 0.25)); B.q *= damp; B.r *= exp(-dt * (grounded ? 2.5 : 0.8));
  B.x += B.vx * dt; B.y += B.vy * dt; B.z += B.vz * dt;
  B.pitch += B.q * dt; B.yaw += B.r * dt;
  if (B.pitch > PI) B.pitch -= TAU; else if (B.pitch < -PI) B.pitch += TAU;
  // lean into turns (visual)
  // on the ground the bike leans into its turns; gliding, steering banks it
  const leanT = grounded ? clamp(Math.atan(vlong * B.r / 9.81), -0.8, 0.8) : B.wdep > 0.5 ? B.wr * 0.75 * (1 - 0.6 * abs(B.stl)) + B.stl * 0.9 + _gst * 0.12 * B.wing : B.lean * 0.9;
  B.lean += (leanT - B.lean) * min(1, dt * 4.5);
  // wheels turning; the rear spins up when it breaks traction
  B.spinF += vlong / k.Rf * dt;
  const wT = B.gR > 0 ? vlong / k.Rr * (1 + B.slip * 1.5) : B.wR + (B.thr * 60 - IN.brk * 200) * dt;
  B.wR += (max(wT, 0) - B.wR) * min(1, dt * 20); B.spinR += B.wR * dt;
  B.speed = spd; B.vlong = vlong;
  // crash: upside down on the ground, or the frame / rider's head digs into the sand
  const hb = heightAt(B.x, B.z), hx = B.x + uX * 0.95, hz = B.z + uZ * 0.95, hy = B.y + uY * 0.95;
  if (hy < heightAt(hx, hz) + 0.1 || (grounded && uY < 0.15) || B.hard) { startCrash(); return; }
  if (B.y < hb + 0.22) { B.y = hb + 0.22; if (B.vy < 0) B.vy = 0; }
}
