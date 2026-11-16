// ============================================================================
// WGSL. Every colour is linear light until tone(), which applies exposure, a filmic curve and the display gamma.
// ============================================================================
const W_GLOBALS = /*wgsl*/`
struct G {
  vp: mat4x4f,     // world -> clip (reversed, infinite depth)
  lvp: mat4x4f,    // world -> the bike's shadow map
  cam: vec4f,      // camera position, time
  cr: vec4f,       // camera right scaled to the screen edge, exposure
  cu: vec4f,       // camera up scaled to the screen edge
  cf: vec4f,       // camera forward, near plane distance
  sun: vec4f,      // direction to the sun, how far into night (0 day .. 1 night)
  sunc: vec4f,     // sunlight arriving at the ground, slope of the sun above the horizon
  amb: vec4f,      // light from the whole sky on flat ground, which skyline map faces the sun
  bike: vec4f,     // bike position, terrain shadow at the bike
  sand: vec4f,     // sand albedo
  head: vec4f,     // headlight direction, brightness
  wh0: vec4f,      // where the rear tyre touches the sand, 1 if it does
  wh1: vec4f,      // same for the front tyre
}
@group(0) @binding(0) var<uniform> g: G;
`;

const W_SCENE = W_GLOBALS + /*wgsl*/`
@group(0) @binding(1) var TH: texture_2d<f32>;
@group(0) @binding(2) var TNS: texture_2d<f32>;
@group(0) @binding(3) var SL: sampler;
@group(0) @binding(4) var SKY: texture_2d<f32>;
@group(0) @binding(5) var SS: sampler;
@group(0) @binding(6) var SM: texture_depth_2d;
@group(0) @binding(7) var SC: sampler_comparison;
@group(0) @binding(8) var TX: texture_2d<f32>;
@group(0) @binding(9) var TD: texture_2d<f32>;

fn sky(d: vec3f) -> vec3f {
  return textureSampleLevel(SKY, SS, vec2f(atan2(d.x, d.z) * 0.15915494, sqrt(clamp(d.y, 0.0, 1.0))), 0.0).rgb;
}
// The scene is drawn in linear light into a high-range target; exposure, bloom and the film curve come in W_POST.
fn tone(c: vec3f, frag: vec2f) -> vec4f {
  return vec4f(min(max(c, vec3f(0.0)), vec3f(40.0)), 1.0);
}
// ground height exactly as the terrain mesh draws it
fn hAt(p: vec2f) -> f32 {
  let f0 = floor(p);
  let f = p - f0;
  let i = vec2i(f0);
  let a = textureLoad(TH, i & vec2i(2047), 0).r;
  let b = textureLoad(TH, (i + vec2i(1, 0)) & vec2i(2047), 0).r;
  let c = textureLoad(TH, (i + vec2i(1, 1)) & vec2i(2047), 0).r;
  let d = textureLoad(TH, (i + vec2i(0, 1)) & vec2i(2047), 0).r;
  if (f.x >= f.y) { return a + (b - a) * f.x + (c - b) * f.y; }
  return a + (c - d) * f.x + (d - a) * f.y;
}
// haze: distant sand fades into the colour of the sky just above the horizon in that direction
fn fog(c: vec3f, w: vec3f) -> vec3f {
  let v = w - g.cam.xyz;
  let d = length(v);
  let dir = v / d;
  let fc = sky(normalize(vec3f(dir.x, max(dir.y, 0.0) * 0.5 + 0.035, dir.z)));
  // far terrain dissolves into the horizon instead of ending at an edge
  return mix(fc, c, exp(-d * 0.00021) * (1.0 - smoothstep(4800.0, 6600.0, d)));
}
// shadow thrown by the bike and rider
fn bikeShadow(w: vec3f) -> f32 {
  let p = g.lvp * vec4f(w, 1.0);
  let uv = p.xy * vec2f(0.5, -0.5) + 0.5;
  if (max(abs(uv.x - 0.5), abs(uv.y - 0.5)) > 0.49 || p.z > 0.999) { return 1.0; }
  let z = p.z - 0.0004;
  // 3 x 3 taps, 1.6 texels apart: soft edges with no banding
  var a = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) { a += textureSampleCompareLevel(SM, SC, uv + vec2f(f32(x), f32(y)) * 0.00078, z); }
  }
  return a / 9.0;
}
// light from the sky dome plus sunlight bounced off the surrounding sand
fn ambient(n: vec3f) -> vec3f {
  // the last term is the warm glow of the sky around the sun, which keeps shade from going green at low sun
  return g.amb.rgb * (0.5 + 0.5 * n.y) + g.sand.rgb * (g.sunc.rgb * g.sun.y + g.amb.rgb) * 0.318 * (0.62 - 0.5 * n.y) + g.sunc.rgb * 0.03;
}
// clouds drift on a flat layer 900 m up; q is a point on that layer
fn cloudD(q: vec2f) -> f32 {
  let u = q * 0.0017 + vec2f(g.cam.w * 0.013, g.cam.w * 0.003);
  return smoothstep(0.53, 0.68, vn(u) * 0.5 + vn(u * 2.3 + 7.0) * 0.28 + vn(u * 5.3 + 3.0) * 0.14 + vn(u * 11.7 + 9.0) * 0.08);
}
// how much sun gets through the clouds to a point near the ground (the cloud layer projected along the sun)
fn cloudLight(p: vec3f) -> f32 {
  return 1.0 - 0.62 * cloudD(p.xz + g.sun.xz * ((900.0 - p.y) / max(g.sun.y, 0.08)));
}
// the baked relief read on three planes, for rocks: xyz = how far to tip the normal, w = height
fn tri(p: vec3f, n: vec3f, sc: f32) -> vec4f {
  let w0 = pow(abs(n), vec3f(4.0));
  let w = w0 / (w0.x + w0.y + w0.z);
  let a = textureSample(TD, SL, p.zy * sc);
  let b = textureSample(TD, SL, p.xz * sc);
  let c = textureSample(TD, SL, p.xy * sc);
  return vec4f(vec3f(0.0, a.y - 0.5, a.x - 0.5) * w.x + vec3f(b.x - 0.5, 0.0, b.y - 0.5) * w.y + vec3f(c.x - 0.5, c.y - 0.5, 0.0) * w.z, a.z * w.x + b.z * w.y + c.z * w.z);
}
fn h21(p: vec2f) -> f32 {
  var q = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn vn(p: vec2f) -> f32 {
  let i = floor(p);
  var f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2f(1.0, 0.0)), f.x), mix(h21(i + vec2f(0.0, 1.0)), h21(i + vec2f(1.0, 1.0)), f.x), f.y);
}
`;

// ---------------------------------------------------------------- terrain
const W_TERRAIN = W_SCENE + /*wgsl*/`
struct TV { @builtin(position) p: vec4f, @location(0) w: vec3f }
// v: grid position 0..32 and skirt flag; n: node origin (x, z) and cell size
@vertex fn vs(@location(0) v: vec3f, @location(1) n: vec4f) -> TV {
  let xz = n.xy + v.xy * n.z;
  // coarser patches read a smoothed copy of the heights, so distant crest lines do not turn into a saw-tooth
  let lv = u32(round(log2(n.z)));
  let t = (vec2i(floor(xz + 0.5)) >> vec2u(lv)) & vec2i(i32(2047u >> lv));
  let h = textureLoad(TH, t, i32(lv)).r - v.z * (n.z * 1.5 + 0.5);
  var o: TV;
  o.w = vec3f(xz.x, h, xz.y);
  o.p = g.vp * vec4f(o.w, 1.0);
  return o;
}
@fragment fn fs(i: TV) -> @location(0) vec4f {
  let p = i.w.xz;
  let s = textureSample(TNS, SL, (p + 0.5) / 2048.0);
  // openness: troughs and the feet of slip faces see less sky
  let tx = textureSample(TX, SL, (p + 0.5) / 2048.0);
  let open = tx.z;
  // ramps are packed sand: firmer, a shade darker and greyer, with no ripples
  let ramp = tx.w;
  var ao = open * open * open;
  var n = vec3f(s.x, sqrt(max(1.0 - s.x * s.x - s.y * s.y, 0.01)), s.y);
  let vv = g.cam.xyz - i.w;
  let dist = length(vv);
  let V = vv / dist;
  // Baked sand relief, read at four scales at once (tiles of 14 m, 3.2 m, 0.7 m and 0.17 m) so there is detail at
  // every distance and no visible repeat; two much larger reads of its mottling drive slow colour change.
  let gx = dpdx(p);
  let gy = dpdy(p);
  let pm = p - 2048.0 * floor(p / 2048.0);
  let dA = textureSampleGrad(TD, SL, pm * 0.0703125, gx * 0.0703125, gy * 0.0703125);
  let dB = textureSampleGrad(TD, SL, pm * 0.3125, gx * 0.3125, gy * 0.3125);
  let dC = textureSampleGrad(TD, SL, pm * 1.40625, gx * 1.40625, gy * 1.40625);
  let dF = textureSampleGrad(TD, SL, pm * 5.90625, gx * 5.90625, gy * 5.90625);
  let big = textureSampleGrad(TD, SL, pm * 0.01171875 + 0.37, gx * 0.01171875, gy * 0.01171875).a;
  let big2 = textureSampleGrad(TD, SL, pm.yx * 0.02734375, gx.yx * 0.02734375, gy.yx * 0.02734375).a;
  let hgt = dA.z * 0.45 + dB.z * 0.35 + dC.z * 0.2;
  // the finer the layer, the sooner it fades, so nothing ever gets smaller than a pixel and shimmers
  let dn = ((dA.xy - 0.5) * 0.16 + (dB.xy - 0.5) * 0.3 + (dC.xy - 0.5) * 0.7 * (1.0 - smoothstep(12.0, 60.0, dist)) + (dF.xy - 0.5) * 0.95 * (1.0 - smoothstep(1.5, 10.0, dist))) * 0.6;
  // hollows in the relief hold shade
  ao *= mix(1.0, smoothstep(0.1, 0.6, hgt), 0.3);
  // wind ripples: fine ones underfoot, metre-scale ones further out; none on the steep slip faces
  // ripples come in patches, bend and fork (the phase is warped at four scales), and are gone within a few tens of metres
  let calm = smoothstep(0.80, 0.93, n.y) * (0.2 + 0.8 * smoothstep(0.25, 0.6, vn(p * 0.031 + 7.0))) * (1.0 - ramp);
  let warp = vn(p * 0.045) * 12.0 + vn(p * 0.17) * 4.5 + vn(p * 0.37) * 2.4 + vn(p * 1.3) * 0.8;
  let f1 = (1.0 - smoothstep(4.0, 22.0, dist)) * calm * smoothstep(0.3, 0.6, vn(p * 0.07 + 21.0));
  let f2 = (1.0 - smoothstep(35.0, 160.0, dist)) * calm * smoothstep(0.56, 0.8, vn(p * 0.019 + 40.0));
  // each ripple set fades out before it gets finer than the pixels, so it never turns into moire
  let ph1 = (p.x + p.y * 0.22) * 34.0 + warp * 2.2;
  let ph2 = (p.x * 0.94 - p.y * 0.3) * 2.3 + vn(p * 0.06) * 13.0 + vn(p * 0.19) * 6.0;
  // a real ripple is lopsided: a long back and a short steep face
  let r1 = (cos(ph1) + 0.35 * cos(2.0 * ph1 + 1.0)) * 0.16 * f1 * (1.0 - smoothstep(0.4, 1.3, fwidth(ph1)));
  let r2 = cos(ph2) * (0.45 + 0.55 * cos((p.x * 0.35 + p.y) * 1.1 + vn(p * 0.09 + 60.0) * 11.0)) * 0.032 * f2 * (1.0 - smoothstep(0.4, 1.3, fwidth(ph2)));
  n = normalize(vec3f(n.x - r1 - r2 * 0.94 - dn.x, n.y, n.z - r1 * 0.22 + r2 * 0.3 - dn.y));

  let L = g.sun.xyz;
  // in the sun when the sun stands higher than the skyline in its direction
  let hz = mix(s.z, s.w, g.amb.w);
  let sh = smoothstep(hz - 0.02, hz + 0.035, g.sunc.w) * bikeShadow(i.w) * cloudLight(i.w);
  let nl = max(dot(n, L), 0.0);
  // colour drifts a little across the dune field
  // colour drifts across the field, runs in streaks along the wind, is coarser and darker in the troughs, and has grain up close
  // Sand colour: paler and redder beds laid down across the field, streaks along the wind, dark heavy grains
  // gathered in the low spots of the relief, coarser and darker in the troughs between dunes.
  let bed = 0.5 + 0.5 * cos((big * 5.0 + big2 * 3.0 + hgt * 0.5) * 6.2832);
  // loose sand skimming the surface on the wind
  let sheet = smoothstep(0.5, 0.8, vn(vec2f(p.x * 0.16 - g.cam.w * 1.3, p.y * 1.2)) * (0.4 + vn(p * 0.035 + g.cam.w * 0.04))) * calm * (1.0 - smoothstep(20.0, 90.0, dist));
  let alb = g.sand.rgb * (0.87 + 0.26 * hgt) * (1.0 + (dF.z - 0.5) * 0.55 * (1.0 - smoothstep(1.5, 10.0, dist)) + (dC.z - 0.5) * 0.3 * (1.0 - smoothstep(12.0, 60.0, dist))) * mix(vec3f(0.96, 0.975, 1.0), vec3f(1.05, 0.995, 0.93), bed)
    * (0.93 + 0.14 * vn(vec2f(p.x * 0.03, p.y * 0.4) + 5.0)) * mix(0.84, 1.0, smoothstep(0.78, 0.95, open))
    * (1.0 - 0.1 * smoothstep(0.55, 0.8, big2) * (1.0 - hgt)) * (1.0 + 0.14 * sheet)
    * mix(vec3f(1.0), vec3f(0.8, 0.82, 0.86) * (0.92 + 0.16 * vn(vec2f(p.x * 0.5, p.y * 4.0))), ramp);
  var c = alb * 0.3183 * (g.sunc.rgb * nl * sh + ambient(n) * ao);
  // the sky mirrored at grazing angles gives crests their sheen; lit sand gets a little extra saturation
  c += sky(reflect(-V, n)) * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.07 * ao;
  c += alb * alb * 0.3183 * dot(g.sunc.rgb, vec3f(0.33)) * nl * sh * 0.1;
  // contact shade where each tyre presses into the sand
  let w0 = i.w - g.wh0.xyz;
  let w1 = i.w - g.wh1.xyz;
  c *= 1.0 - 0.55 * max(g.wh0.w * exp(-dot(w0, w0) * 26.0), g.wh1.w * exp(-dot(w1, w1) * 30.0));
  // a soft sheen toward the sun, and single grains catching the light close to the camera
  let hv = normalize(L + V);
  let nh = max(dot(n, hv), 0.0);
  c += g.sunc.rgb * sh * nl * (pow(nh, 22.0) * 0.035);
  let cell = floor(p * 420.0);
  let gl = step(0.9985, h21(cell)) * pow(max(dot(reflect(-L, normalize(n + (vec3f(h21(cell + 1.7), 0.5, h21(cell + 5.1)) - 0.5) * 0.9)), V), 0.0), 9.0);
  c += g.sunc.rgb * sh * gl * 0.4 * (1.0 - smoothstep(3.0, 16.0, dist));
  // headlight
  let hp = i.w - (g.bike.xyz + g.head.xyz * 0.9 + vec3f(0.0, 0.25, 0.0));
  let hd = length(hp);
  let hdir = hp / hd;
  // dipped a little toward the ground: a wide soft flood with a brighter spot in the middle
  let hc = dot(hdir, normalize(g.head.xyz - vec3f(0.0, 0.16, 0.0)));
  let cone = smoothstep(0.25, 0.96, hc) * (0.25 + 0.75 * smoothstep(0.88, 0.995, hc));
  c += alb * 0.3183 * vec3f(1.0, 0.93, 0.8) * g.head.w * 1.1 * cone * max(dot(n, -hdir) + 0.3, 0.0) / (1.3 * (1.0 + hd * 0.05 + hd * hd * 0.004));
  return tone(fog(c, i.w), i.p.xy);
}
`;

// ---------------------------------------------------------------- sky
const W_SKY = W_SCENE + /*wgsl*/`
struct SV { @builtin(position) p: vec4f, @location(0) q: vec2f }
@vertex fn vs(@builtin(vertex_index) vi: u32) -> SV {
  var o: SV;
  o.q = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.p = vec4f(o.q, 0.0, 1.0);
  return o;
}
@fragment fn fs(i: SV) -> @location(0) vec4f {
  let d = normalize(g.cf.xyz + g.cr.xyz * i.q.x + g.cu.xyz * i.q.y);
  var c = sky(vec3f(d.x, max(d.y, 0.0) + 0.004, d.z)) * (1.0 + 0.9 * max(g.sun.y, 0.0)) + vec3f(0.0005, 0.0009, 0.002) * g.sun.w;
  let mu = dot(d, g.sun.xyz);
  let up = smoothstep(-0.012, 0.004, d.y);
  c += g.sunc.rgb * up * (smoothstep(0.99993, 0.99998, mu) * 60.0 + pow(max(mu, 0.0), 2500.0) * 0.25 + pow(max(mu, 0.0), 120.0) * 0.006);
  // clouds: the same drifting layer that throws the shadows on the ground
  var cd = 0.0;
  if (d.y > 0.015) {
    let tc = (900.0 - g.cam.y) / d.y;
    let q = g.cam.xz + d.xz * tc;
    cd = cloudD(q) * smoothstep(0.015, 0.1, d.y);
    // lit by the sun (brighter where it shines through the edges toward us) and by the sky, hazed with distance
    let lit = g.sunc.rgb * (0.11 + 0.2 * pow(max(mu, 0.0), 6.0)) * (1.0 - 0.72 * cloudD(q + g.sun.xz * 330.0)) + g.amb.rgb * 0.36;
    c = mix(c, mix(sky(vec3f(d.x, 0.03, d.z)), lit, exp(-tc * 0.00006)), cd * 0.92);
  }
  // stars
  let st = floor(d * 420.0);
  let sv = h21(st.xy + st.z * 37.0);
  c += vec3f(0.85, 0.92, 1.0) * max(sv - 0.9991, 0.0) * 40.0 * g.sun.w * up * (1.0 - cd) * (0.3 + 0.7 * h21(st.xy + 3.1));
  return tone(c, i.p.xy);
}
`;

// ---------------------------------------------------------------- bike + rider
const W_BIKE = W_SCENE + /*wgsl*/`
@group(1) @binding(0) var<uniform> M: mat4x4f;
struct BV { @builtin(position) p: vec4f, @location(0) w: vec3f, @location(1) n: vec3f, @location(2) @interpolate(flat) m: f32, @location(3) l: vec3f }
@vertex fn vs(@location(0) v: vec3f, @location(1) n: vec4f) -> BV {
  var o: BV;
  let w = M * vec4f(v, 1.0);
  o.w = w.xyz;
  o.n = (M * vec4f(n.xyz, 0.0)).xyz;
  o.m = n.w * 127.0;
  o.l = v;
  o.p = g.vp * w;
  return o;
}
@fragment fn fs(i: BV) -> @location(0) vec4f {
  // albedo + gloss: 0 tyre, 1 frame, 2 plastics, 3 seat, 4 aluminium, 5 neck, 6 white plastic, 7 boots and gloves,
  // 8 steel, 9 jersey, 10 engine, 11 pants, 12 goggle lens, 13 headlamp, 14 rims, 15 shock spring
  var pal = array<vec4f, 27>(
    vec4f(0.016, 0.016, 0.017, 0.06), vec4f(0.02, 0.02, 0.022, 0.6), vec4f(0.82, 0.15, 0.015, 0.8), vec4f(0.02, 0.02, 0.024, 0.1),
    vec4f(0.5, 0.5, 0.52, 0.9), vec4f(0.3, 0.2, 0.15, 0.1), vec4f(0.8, 0.8, 0.78, 0.8), vec4f(0.028, 0.028, 0.03, 0.35),
    vec4f(0.6, 0.61, 0.63, 1.1), vec4f(0.03, 0.085, 0.4, 0.06), vec4f(0.15, 0.15, 0.16, 0.5), vec4f(0.02, 0.028, 0.07, 0.06),
    vec4f(0.012, 0.013, 0.016, 2.2), vec4f(0.85, 0.83, 0.75, 0.6), vec4f(0.028, 0.028, 0.033, 0.8), vec4f(0.78, 0.76, 0.7, 0.5),
    vec4f(0.03, 0.085, 0.4, 0.06), vec4f(0.4, 0.42, 0.45, 1.0), vec4f(1.0, 0.5, 0.1, 0.0),
    vec4f(0.28, 0.12, 0.06, 0.15), vec4f(0.72, 0.72, 0.68, 0.4), vec4f(0.6, 0.05, 0.03, 0.4), vec4f(0.2, 0.13, 0.08, 0.05),
    vec4f(0.07, 0.2, 0.04, 0.2), vec4f(0.4, 0.28, 0.18, 0.05), vec4f(0.68, 0.64, 0.52, 0.15), vec4f(0.015, 0.1, 0.12, 2.4));
  let id = u32(clamp(i.m + 0.5, 0.0, 26.0));
  // rocket flame: pure light, white-hot at the nozzle cooling to orange, flickering
  if (id == 18u) {
    let k = clamp(-i.l.z, 0.0, 1.0);
    let fl = 0.72 + 0.28 * sin(g.cam.w * 95.0 + i.l.z * 23.0) * sin(g.cam.w * 61.0 + 1.3);
    return tone(mix(vec3f(1.0, 0.92, 0.75), vec3f(1.0, 0.3, 0.03), k) * (30.0 * (1.0 - 0.75 * k) * fl), i.p.xy);
  }
  var m = pal[id];
  var n = normalize(i.n);
  let l = i.l;
  // fabric: folds and creases break up the smooth forms
  if (id == 9u || id == 11u || id == 16u) {
    let q = vec2f(l.z * 15.0 + l.x * 8.0, l.y * 30.0 + l.z * 6.0);
    n = normalize(n + (vec3f(vn(q), vn(q + 17.0), vn(q + 31.0)) - 0.5) * 0.5);
  }
  // graphics, in the part's own coordinates
  if (id == 2u) {
    // black and white flashes across the shrouds and fenders
    let d = l.y * 1.4 + l.z;
    let band = smoothstep(0.03, 0.035, abs(fract(d * 3.2) - 0.5) - 0.3);
    m = vec4f(mix(m.rgb, mix(vec3f(0.02), vec3f(0.8), step(0.5, fract(d * 1.6))), band * step(0.16, abs(l.x)) * step(l.z, 0.5) * step(0.03, l.z) * step(l.y, 0.3)), m.a);
  } else if (id == 6u) {
    // black number block on the plates
    let q = abs(vec2f(l.y - 0.3, (abs(l.x) - 0.0) * 0.0 + l.z - 0.545));
    let side = step(0.1, abs(l.x)) * (1.0 - smoothstep(0.05, 0.055, max(abs(l.y - 0.21), abs(l.z + 0.44) * 0.6)));
    let front = step(abs(l.x), 0.06) * step(0.4, l.z) * (1.0 - smoothstep(0.05, 0.055, q.x)) * step(l.z, 0.57);
    m = vec4f(mix(m.rgb, vec3f(0.02), max(side, front) * step(l.y, 0.6)), m.a);
  } else if (id == 9u) {
    // jersey: white chest band, orange cuffs on the forearms
    let chest = smoothstep(0.255, 0.26, l.y) * (1.0 - smoothstep(0.325, 0.33, l.y)) * step(0.1, abs(l.x) + abs(l.z));
    m = vec4f(mix(m.rgb, vec3f(0.7), chest), m.a);
    m = vec4f(mix(m.rgb, vec3f(0.82, 0.15, 0.015), step(abs(l.x) + abs(l.y), 0.2) * smoothstep(0.7, 0.705, l.z)), m.a);
    m = vec4f(m.rgb * (0.9 + 0.2 * vn(i.w.xz * 60.0 + i.w.y * 45.0)), m.a);
  } else if (id == 11u) {
    // pants: orange stripe down the outside of the thigh
    m = vec4f(mix(m.rgb, vec3f(0.82, 0.15, 0.015), smoothstep(0.066, 0.072, abs(l.x)) * 0.9 * step(0.05, l.z)), m.a);
  } else if (id == 17u) {
    // wing skin: brushed along the span, with panel joins and a row of rivets beside each
    let px = fract(abs(l.x) * 4.0);
    let join = max(step(0.955, px), step(0.97, fract(l.z * 6.0 + 0.5)));
    let rivet = step(0.86, px) * step(px, 0.9) * step(0.7, fract(l.z * 22.0));
    m = vec4f(m.rgb * (1.0 - 0.6 * join) * (1.0 - 0.45 * rivet) * (0.82 + 0.3 * vn(vec2f(l.x * 4.0, l.z * 60.0))), m.a * (1.0 - 0.6 * join));
  } else if (id == 0u) {
    // sidewall a touch lighter than the tread
    m = vec4f(m.rgb * (1.0 + 0.8 * smoothstep(0.02, 0.05, abs(l.x))), m.a);
  }
  // plastics are scuffed and unevenly glossy, not showroom new
  if (id == 2u || id == 6u) { m = vec4f(m.rgb * (0.8 + 0.32 * vn(l.zy * 55.0 + l.x * 31.0)), m.a * (0.55 + 0.7 * vn(l.yz * 23.0 + 5.0))); }
  // dust: sand clings to everything low on the bike, and a film of it dulls the rest
  let dust = clamp(0.04 + 0.55 * smoothstep(0.0, -0.55, i.w.y - g.bike.y) + 0.16 * vn(i.w.xz * 23.0 + i.w.y * 17.0) - 0.08, 0.0, 0.8) * step(0.5, abs(f32(id) - 12.5));
  // landmarks (19 and up) weather on their own terms: sand drifted against their feet, streaks and patches higher up
  var dustL = clamp(0.75 - (i.w.y - hAt(i.w.xz)) * 0.5, 0.0, 0.75) + 0.3 * vn(i.w.xz * 0.9 + i.w.y * 0.6) * vn(i.w.xy * 0.21);
  if (id == 26u) { dustL = 0.0; }
  if (id >= 19u) { m = vec4f(m.rgb * (0.75 + 0.5 * vn(i.w.xy * 1.7 + i.w.z * 1.3)), m.a); }
  var alb = mix(m.rgb, g.sand.rgb * 0.85, select(dust, dustL, id >= 19u));
  let gloss = m.a * (1.0 - 0.75 * select(dust, dustL, id >= 19u));
  let L = g.sun.xyz;
  let V = normalize(g.cam.xyz - i.w);
  let sh = g.bike.w * bikeShadow(i.w + n * 0.03 + L * 0.03) * cloudLight(i.w);
  // cloth wraps light round the form; hard surfaces do not
  let cloth = max(step(8.5, f32(id)) * step(f32(id), 11.5) * step(0.5, abs(f32(id) - 10.0)), step(15.5, f32(id)));
  let nl = max((dot(n, L) + 0.3 * cloth) / (1.0 + 0.3 * cloth), 0.0);
  var c = alb * 0.3183 * (g.sunc.rgb * nl * sh + ambient(n) * (0.55 + 0.45 * smoothstep(-0.7, 0.3, n.y)));
  let nh = max(dot(n, normalize(L + V)), 0.0);
  let fr = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let r = reflect(-V, n);
  c += g.sunc.rgb * sh * max(dot(n, L), 0.0) * (pow(nh, 90.0) * 0.9 + pow(nh, 14.0) * 0.05) * gloss;
  c += mix(g.sand.rgb * 0.3183 * (g.sunc.rgb * g.sun.y + g.amb.rgb), sky(r), smoothstep(-0.1, 0.1, r.y)) * fr * gloss * 0.55;
  if (id == 17u) {
    // sunlight on the wings. Brushed metal is a field of tiny facets, each tipped a little its own way: the ones that
    // happen to face halfway between the sun and the eye flash, and a different set flashes as the wing banks or the
    // sun moves. Under that, a wide soft sheen and a hot core, bright enough to bloom.
    let hv = normalize(L + V);
    let cp = vec2f(l.x, l.z) * 110.0;
    let cell = floor(cp);
    let tilt = vec3f(h21(cell), h21(cell + 7.3), h21(cell + 19.1)) - 0.5;
    // (the skin also flexes a little in the airflow, which keeps the flashes moving in a steady glide)
    let gn = normalize(n + tilt * 2.2 + vec3f(0.0, 0.0, 0.12) * sin(g.cam.w * 2.3 + l.x * 2.5));
    let tw = 0.55 + 0.45 * sin(g.cam.w * 7.0 + h21(cell + 3.7) * 6.283);
    let near = 1.0 - smoothstep(14.0, 40.0, distance(g.cam.xyz, i.w));
    let glint = pow(max(dot(gn, hv), 0.0), 380.0) * tw * near * 34.0 * (1.0 - smoothstep(0.1, 0.5, length(fract(cp) - 0.5)));
    c += g.sunc.rgb * sh * smoothstep(-0.05, 0.15, dot(n, L)) * (glint + pow(nh, 320.0) * 7.0 + pow(nh, 22.0) * 0.45) * gloss;
  }
  // light spilling back from the headlight beam at night; the lamp itself glows
  c += alb * vec3f(1.0, 0.93, 0.8) * g.head.w * 0.0035 * max(dot(n, g.head.xyz) + 0.3, 0.0);
  // only the front of the lens glows, so the rider does not see it from behind
  if (id == 13u) { c += vec3f(1.0, 0.93, 0.8) * (g.head.w * 6.0 + 0.02) * smoothstep(0.2, 0.6, dot(n, g.head.xyz)) * smoothstep(0.0, 0.25, dot(V, g.head.xyz)); }
  return tone(fog(c, i.w), i.p.xy);
}
`;

// depth only, into the bike's shadow map
const W_SHADOW = W_GLOBALS + /*wgsl*/`
@group(1) @binding(0) var<uniform> M: mat4x4f;
@vertex fn vs(@location(0) v: vec3f) -> @builtin(position) vec4f {
  return g.lvp * (M * vec4f(v, 1.0));
}
`;

// ---------------------------------------------------------------- dust kicked up by the wheels
const W_DUST = W_SCENE + /*wgsl*/`
struct DV { @builtin(position) p: vec4f, @location(0) q: vec2f, @location(1) a: vec3f, @location(2) w: vec3f }
// a: position + size; b: opacity, seed, terrain shadow
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> DV {
  var o: DV;
  var k = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  o.q = k[vi];
  // never drawn smaller than a pixel: a far-off grain dims instead of flickering
  let px = distance(a.xyz, g.cam.xyz) * 0.0011;
  let dim = min(1.0, a.w / px);
  o.w = a.xyz + (normalize(g.cr.xyz) * o.q.x + normalize(g.cu.xyz) * o.q.y) * max(a.w, px);
  o.a = vec3f(b.x * dim * dim, b.y, b.z * cloudLight(a.xyz));
  o.p = g.vp * vec4f(o.w, 1.0);
  return o;
}
@fragment fn fs(i: DV) -> @location(0) vec4f {
  let d = length(i.q);
  let puff = vn(i.q * 2.3 + i.a.y * 37.0) * 0.6 + 0.55;
  let al = min(i.a.x * (1.0 - smoothstep(0.1, 1.0, d)) * puff * 1.4, 0.9);
  // dust is lit from every side: sunlight scatters through it
  // and glows when the sun is behind it
  let mu = max(dot(normalize(i.w - g.cam.xyz), g.sun.xyz), 0.0);
  let c = g.sand.rgb * 1.25 * 0.3183 * (g.sunc.rgb * (0.8 + 0.2 * i.q.y + 0.9 * mu * mu * mu) * mix(0.06, 1.0, i.a.z) + g.amb.rgb * 1.2);
  return vec4f(tone(fog(c, i.w), i.p.xy).rgb, al);
}
`;

// ---------------------------------------------------------------- tyre tracks
// one instance per stretch of track: a = start + half width, b = end + strength. Darkens the sand it lies on.
const W_TRACK = W_SCENE + /*wgsl*/`
struct KV { @builtin(position) p: vec4f, @location(0) q: vec2f, @location(1) w: vec3f, @location(2) e: vec2f }
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> KV {
  var o: KV;
  var k = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = k[vi];
  let d = b.xyz - a.xyz;
  let side = normalize(vec3f(d.z, 0.0, -d.x));
  o.w = mix(a.xyz, b.xyz, c.y) + side * c.x * a.w + vec3f(0.0, 0.035, 0.0);
  o.q = vec2f(c.x, b.w);
  // which side of the rut the sun is on, and how far along this stretch
  o.e = vec2f(dot(side.xz, g.sun.xz), c.y);
  o.p = g.vp * vec4f(o.w, 1.0);
  return o;
}
@fragment fn fs(i: KV) -> @location(0) vec4f {
  // ragged edges, not ruled lines
  let x = abs(i.q.x + (vn(i.w.xz * 7.0) - 0.5) * 0.32);
  // a pressed-down groove with a slightly raised, brighter lip of thrown sand on each side
  // pressed in, with the paddle marks along it; the wall of the rut that faces the sun is bright, the other in shade
  let groove = (1.0 - smoothstep(0.3, 0.8, x)) * 0.22 * (0.78 + 0.22 * cos(i.e.y * 12.566));
  let wall = smoothstep(0.2, 0.45, x) * (1.0 - smoothstep(0.6, 0.9, x));
  let lit = -sign(i.q.x) * i.e.x * wall * step(0.0, g.sunc.w) * 0.4;
  let lip = smoothstep(0.55, 0.8, x) * (1.0 - smoothstep(0.8, 1.0, x)) * 0.2;
  let fade = i.q.y * (1.0 - smoothstep(60.0, 260.0, length(i.w - g.cam.xyz)));
  return vec4f(vec3f(1.0 - (groove - lip - lit) * fade), 1.0);
}
`;

// ---------------------------------------------------------------- sky texture
// The atmosphere (same maths as skyColor in terrain.js) rendered into the 256 x 128 sky texture whenever the sun moves.
const W_SKYBAKE = W_GLOBALS + /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return vec4f(vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let az = p.x / 256.0 * 6.2831853;
  let v = p.y / 128.0;
  let y = v * v;
  let c = sqrt(1.0 - y * y);
  let d = vec3f(sin(az) * c, y, cos(az) * c);
  let S = g.sun.xyz;
  let rP = 6371000.0;
  let rA = 6471000.0;
  let kR = vec3f(5.5e-6, 13.0e-6, 22.4e-6);
  let kM = 21e-6;
  let y0 = rP + 300.0;
  let b = y0 * d.y;
  let ds = (sqrt(b * b - (y0 * y0 - rA * rA)) - b) / 16.0;
  let mu = dot(d, S);
  let gg = 0.5776;
  let pR = 0.0596831 * (1.0 + mu * mu);
  let pM = 0.1193662 * ((1.0 - gg) * (1.0 + mu * mu)) / (pow(1.0 + gg - 2.0 * mu * 0.76, 1.5) * (2.0 + gg));
  var oR = 0.0;
  var oM = 0.0;
  var sr = vec3f(0.0);
  var sm = vec3f(0.0);
  for (var i = 0; i < 16; i++) {
    let pos = vec3f(0.0, y0, 0.0) + d * ((f32(i) + 0.5) * ds);
    let pl = length(pos);
    let sR = exp((rP - pl) / 8000.0) * ds;
    let sM = exp((rP - pl) / 1200.0) * ds;
    oR += sR;
    oM += sM;
    let bq = dot(pos, S);
    let tj = (sqrt(max(bq * bq - (pl * pl - rA * rA), 0.0)) - bq) / 6.0;
    var jR = 0.0;
    var jM = 0.0;
    for (var j = 0; j < 6; j++) {
      let hj = max(length(pos + S * ((f32(j) + 0.5) * tj)) - rP, -20000.0);
      jR += exp(-hj / 8000.0) * tj;
      jM += exp(-hj / 1200.0) * tj;
    }
    let aM = kM * (oM + jM);
    sr += sR * exp(-(aM + kR * (oR + jR)));
    sm += sM * exp(-(aM + kR * (oR + jR)));
  }
  return vec4f(33.0 * (pR * kR * sr + pM * kM * sm), 1.0);
}
`;

// ---------------------------------------------------------------- stones and scrub
const W_PROP = W_SCENE + /*wgsl*/`
struct PV { @builtin(position) p: vec4f, @location(0) w: vec3f, @location(1) n: vec3f, @location(2) k: vec2f }
// a: position + size; b: yaw, vertical squash
@vertex fn vs(@location(0) v: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f) -> PV {
  var o: PV;
  let c = cos(b.x);
  let s = sin(b.x);
  // the field repeats: draw the copy nearest the camera
  let wrap = round((g.cam.xz - a.xz) / 2048.0) * 2048.0;
  let base = vec3f(a.x + wrap.x, a.y, a.z + wrap.y);
  // small things shrink to nothing before they are dropped, so nothing pops
  let dc = distance(base, g.cam.xyz);
  let far = clamp(a.w * 650.0, 40.0, 450.0);
  o.w = base + vec3f(v.x * c + v.z * s, v.y * b.y, v.z * c - v.x * s) * a.w * (1.0 - smoothstep(far * 0.7, far, dc));
  o.n = normalize(vec3f(n.x * c + n.z * s, n.y / b.y, n.z * c - n.x * s));
  o.k = vec2f(n.w * 127.0, v.y);
  o.p = g.vp * vec4f(o.w, 1.0);
  if (dc > far) { o.p = vec4f(0.0, 0.0, -1.0, 1.0); }
  return o;
}
@fragment fn fs(i: PV) -> @location(0) vec4f {
  let uv = (i.w.xz + 0.5) / 2048.0;
  let s = textureSample(TNS, SL, uv);
  let open = textureSample(TX, SL, uv).z;
  let hz = mix(s.z, s.w, g.amb.w);
  let sh = smoothstep(hz - 0.02, hz + 0.035, g.sunc.w) * cloudLight(i.w);
  let rock = step(i.k.x, 10.5);
  // the same baked relief wrapped round the stone at two scales: pits, ridges and shaded hollows
  let n0 = normalize(i.n);
  let t1 = tri(i.w, n0, 1.3);
  let t2 = tri(i.w, n0, 5.1);
  let n = normalize(n0 - (t1.xyz * 1.3 + t2.xyz * 0.9) * rock);
  let hgt = t1.w * 0.6 + t2.w * 0.4;
  // weathered stone with sand lying in its hollows; dry grey-brown twigs
  let grit = vn(i.w.xz * 9.0 + i.w.y * 7.0);
  var alb = mix(vec3f(0.34, 0.27, 0.15), mix(vec3f(0.15, 0.13, 0.11), vec3f(0.34, 0.3, 0.25), grit), rock);
  alb *= mix(1.0, 0.3 + 1.25 * hgt, rock);
  alb = mix(alb, g.sand.rgb * 0.9, rock * smoothstep(0.55, 0.9, n.y) * smoothstep(0.35, 0.7, vn(i.w.xz * 4.0)) * (1.0 - smoothstep(0.3, 0.55, hgt)));
  // darker where it meets the ground
  let foot = mix(0.35, 1.0, smoothstep(-0.25, 0.35, i.k.y));
  let nl = max(dot(n, g.sun.xyz), 0.0);
  let c = alb * 0.3183 * (g.sunc.rgb * nl * sh * mix(foot, 1.0, 0.6) + ambient(n) * open * open * foot);
  return tone(fog(c, i.w), i.p.xy);
}
`;
// the shadow each stone or bush throws: a strip laid on the ground away from the sun, longer as the sun gets lower
const W_PSHADOW = W_SCENE + /*wgsl*/`
struct QV { @builtin(position) p: vec4f, @location(0) q: vec2f, @location(1) w: vec3f, @location(2) e: vec2f }
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> QV {
  var o: QV;
  var k = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = k[vi % 6u];
  let along = (f32(vi / 6u) + c.y) / 8.0;
  let wrap = round((g.cam.xz - a.xz) / 2048.0) * 2048.0;
  let base = a.xz + wrap;
  let hl = max(length(g.sun.xz), 0.001);
  let dir = g.sun.xz / hl * -1.0;
  let len = min(a.w * b.z / max(g.sunc.w, 0.1), 7.0) + a.w * b.w;
  let wd = a.w * b.w;
  let xz = base + dir * (along * len - wd * 0.5) + vec2f(dir.y, -dir.x) * c.x * wd * (1.0 - 0.3 * along);
  o.w = vec3f(xz.x, hAt(xz) + 0.045, xz.y);
  o.q = vec2f(c.x, along);
  o.p = g.vp * vec4f(o.w, 1.0);
  o.e = vec2f(len / wd, a.w);
  if (distance(o.w, g.cam.xyz) > 260.0) { o.p = vec4f(0.0, 0.0, -1.0, 1.0); }
  return o;
}
@fragment fn fs(i: QV) -> @location(0) vec4f {
  let s = textureSample(TNS, SL, (i.w.xz + 0.5) / 2048.0);
  let hz = mix(s.z, s.w, g.amb.w);
  let lit = smoothstep(hz - 0.02, hz + 0.035, g.sunc.w);
  // soft at the edges and softer toward the far end, like a real penumbra
  let edge = 1.0 - smoothstep(0.45 - 0.3 * i.q.y, 1.0, abs(i.q.x));
  let m = edge * (1.0 - smoothstep(0.55, 1.0, i.q.y)) * smoothstep(0.0, 0.05, i.q.y);
  let sun = dot(g.sunc.rgb, vec3f(0.33));
  // contact shade: a soft dark patch right where the thing meets the sand, whatever the sun is doing
  let cq = vec2f(i.q.x, i.q.y * i.e.x - 0.5);
  let contact = exp(-dot(cq, cq) * 2.2) * 0.42;
  let k = max(m * lit * 0.8 * sun / (sun + 1.2) * step(0.0, g.sunc.w), contact) * (1.0 - smoothstep(150.0, 260.0, distance(i.w, g.cam.xyz)));
  return vec4f(vec3f(1.0 - k), 1.0);
}
`;

// ---------------------------------------------------------------- post: the look
// Ported from Abyssal Garden's chain: bloom (soft-knee first downsample, 6 levels down then additively back up),
// half-resolution light shafts with a depth-aware blur and upsample, and one composite pass for the film look.
const W_FSV = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return vec4f(vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0, 0.0, 1.0);
}
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
`;
const W_BLIT = W_FSV + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
fn tap(uv: vec2f) -> vec4f { return textureSampleLevel(t, s, uv, 0.0); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return tap(uvOf(fc, 2.0)); }
// weights each tap by 1 / (1 + brightest channel) so one glinting pixel cannot flicker the whole bloom
fn kar(c: vec3f) -> vec4f { let w = 1.0 / (1.0 + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.0);
  let e = 1.0 / vec2f(textureDimensions(t));
  let m = kar(min(tap(uv + e * vec2f(-1.0, -1.0)).rgb, vec3f(24.0))) + kar(min(tap(uv + e * vec2f(1.0, -1.0)).rgb, vec3f(24.0)))
    + kar(min(tap(uv + e * vec2f(-1.0, 1.0)).rgb, vec3f(24.0))) + kar(min(tap(uv + e * vec2f(1.0, 1.0)).rgb, vec3f(24.0)));
  return vec4f(m.rgb / m.a, 1.0);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.0);
  let e = 1.0 / vec2f(textureDimensions(t));
  return (tap(uv + e * vec2f(-1.0, -1.0)) + tap(uv + e * vec2f(1.0, -1.0)) + tap(uv + e * vec2f(-1.0, 1.0)) + tap(uv + e * vec2f(1.0, 1.0))) * 0.25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 0.5);
  let e = 0.75 / vec2f(textureDimensions(t));
  return (tap(uv + e * vec2f(-1.0, -1.0)) + tap(uv + e * vec2f(1.0, -1.0)) + tap(uv + e * vec2f(-1.0, 1.0)) + tap(uv + e * vec2f(1.0, 1.0))) * 0.25;
}
`;
// sunlight scattering in the dusty air, cut by the shadows the dunes throw through it (half resolution)
const W_RAYS = W_SCENE + W_FSV + /*wgsl*/`
@group(1) @binding(0) var DP: texture_depth_multisampled_2d;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(DP, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2.0 / vec2f(textureDimensions(DP));
  let nd = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let rv = g.cf.xyz + g.cr.xyz * nd.x + g.cu.xyz * nd.y;
  let rl = length(rv);
  let rd = rv / rl;
  let zl = min(g.cf.w / max(dp, 0.000001), 100000.0);
  let tm = min(zl * rl, 900.0);
  let dt = tm / 20.0;
  let j = ign(fc.xy);
  var acc = 0.0;
  for (var n = 0; n < 20; n++) {
    let t = (f32(n) + j) * dt;
    let p = g.cam.xyz + rd * t;
    let uvp = (p.xz + 0.5) / 2048.0;
    let s = textureSampleLevel(TNS, SL, uvp, 1.0);
    let x = textureSampleLevel(TX, SL, uvp, 0.0);
    let gh = textureLoad(TH, vec2i(floor(p.xz + 0.5)) & vec2i(2047), 0).r;
    // the shadow of the skyline reaches this high above the ground here
    let top = mix(x.x, x.y, g.amb.w) * (mix(s.z, s.w, g.amb.w) - g.sunc.w);
    let vis = smoothstep(top - 0.5, top + 2.5, p.y - gh);
    // dust hangs low
    let dens = exp(max(g.bike.y - p.y, -150.0) / 70.0);
    acc += vis * cloudLight(p) * min(dens, 2.0) * exp(-t * 0.00021);
  }
  let mu = max(dot(rd, g.sun.xyz), 0.0);
  let m4 = mu * mu * mu * mu;
  let m16 = m4 * m4 * m4 * m4;
  let ph = 0.14 + 0.35 * m4 + 0.3 * m16 * m16;
  return vec4f(min(g.sunc.rgb * (acc * dt * ph * 0.000028 * (1.0 - 0.75 * max(g.sun.y, 0.0))), vec3f(20.0)), zl);
}
`;
const W_RBLUR = W_FSV + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy);
  let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.0);
  var ws = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let r = textureLoad(tR, clamp(p + vec2i(x, y), vec2i(0), mx), 0);
      let w = 1.0 / (0.03 + abs(r.a - c.a) / c.a);
      acc += r.rgb * w;
      ws += w;
    }
  }
  return vec4f(acc / ws, c.a);
}
`;
const W_POST = W_GLOBALS + W_FSV + /*wgsl*/`
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth_multisampled_2d;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy / vec2f(textureDimensions(tS));
  let zf = min(g.cf.w / max(textureLoad(tDp, px, 0), 0.000001), 100000.0);
  // depth-aware upsample of the half-res shafts, so they do not bleed across dune crests
  let h = fc.xy * 0.5 - 0.5;
  let b = floor(h);
  let f = h - b;
  let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.0);
  var ws = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1u);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1.0 - f.x, f.x, f32(o.x)) * mix(1.0 - f.y, f.y, f32(o.y));
    let w = (bw + 0.02) / (0.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w;
    ws += w;
  }
  // heat shimmer: distant ground wobbles when the sun is high
  let heat = pow(max(g.sun.y, 0.0), 1.5) * smoothstep(80.0, 600.0, zf) * (1.0 - smoothstep(5000.0, 30000.0, zf));
  let wob = vec2f(sin(fc.y * 0.7 + g.cam.w * 11.0) + sin(fc.y * 1.9 - g.cam.w * 7.0 + fc.x * 0.06), 0.0) * heat * 0.9;
  var c = textureSampleLevel(tS, sC, uv + wob / vec2f(textureDimensions(tS)), 0.0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.0).rgb;
  c = mix(c, bl, 0.07) + bl * 0.035;
  c *= g.cr.w;
  // vignette, film curve, a little extra contrast in the mid-tones, highlights ease toward white
  let q = uv - 0.5;
  c *= 1.0 - dot(q, q) * 0.42;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  let l0 = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let l = mix(l0, l0 * l0 * (3.0 - 2.0 * l0), 0.4);
  c *= l / max(l0, 0.0001);
  c = mix(c, vec3f(l), smoothstep(0.6, 1.0, l) * 0.05);
  c = mix(vec3f(l), c, 0.96) + mix(vec3f(0.006, 0.002, 0.0), vec3f(0.0, 0.001, 0.004), g.sun.w);
  c = pow(max(c, vec3f(0.0)), vec3f(0.4545));
  return vec4f(c + (ign(fc.xy) + ign(fc.xy + 37.0) - 1.0) * (1.0 + 1.5 * g.sun.w) / 255.0, 1.0);
}
`;

// ---------------------------------------------------------------- baked sand relief
// One tileable 1024 x 1024 texture drawn once at load: rg = slope, b = height, a = slow mottling. Made of warped
// drifts, soft ridges, scattered pebbly bumps and single grains. Every lattice wraps, so it repeats without a seam.
const W_DETAIL = W_FSV + /*wgsl*/`
fn hh(p: vec2f) -> f32 {
  var q = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p);
  var f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  let a = i - per * floor(i / per);
  let b = (i + 1.0) - per * floor((i + 1.0) / per);
  return mix(mix(hh(a), hh(vec2f(b.x, a.y)), f.x), mix(hh(vec2f(a.x, b.y)), hh(b), f.x), f.y);
}
fn tf(p: vec2f, per: f32, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  var r = per;
  for (var i = 0; i < oct; i++) { s += a * tn(q, r); q *= 2.0; r *= 2.0; a *= 0.5; }
  return s;
}
fn wor(p: vec2f, per: f32) -> f32 {
  let i = floor(p);
  let f = p - i;
  var d = 9.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = vec2f(f32(x), f32(y));
      let id = i + c;
      let w = id - per * floor(id / per);
      d = min(d, length(c + vec2f(hh(w), hh(w + 17.3)) - f));
    }
  }
  return d;
}
fn H(uv: vec2f) -> f32 {
  let w = vec2f(tf(uv * 4.0 + 1.7, 4.0, 4), tf(uv * 4.0 + 5.3, 4.0, 4)) - 0.5;
  let f = tf(uv * 8.0 + w * 1.2, 8.0, 6);
  let r = 1.0 - abs(2.0 * tf(uv * 6.0 + w * 0.8 + 9.1, 6.0, 4) - 1.0);
  let pe = 1.0 - smoothstep(0.0, 0.32, wor(uv * 28.0, 28.0));
  return f * 0.52 + r * r * 0.2 + pe * 0.2 + hh(floor(uv * 1024.0)) * 0.08;
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let uv = p.xy / 1024.0;
  let e = 1.0 / 1024.0;
  let sl = vec2f(H(uv + vec2f(e, 0.0)) - H(uv - vec2f(e, 0.0)), H(uv + vec2f(0.0, e)) - H(uv - vec2f(0.0, e)));
  return vec4f(clamp(sl * 5.0 + 0.5, vec2f(0.0), vec2f(1.0)), H(uv), tf(uv * 3.0 + 3.7, 3.0, 5));
}
`;

// ---------------------------------------------------------------- dust motes in the air
// A fixed cloud of points that wraps around the camera. Each takes the sun at its own position, so the motes light
// up in open air and go dark inside a dune's shadow. A mote is never drawn smaller than a pixel; it dims instead.
const W_MOTE = W_SCENE + /*wgsl*/`
struct MV { @builtin(position) p: vec4f, @location(0) q: vec2f, @location(1) e: f32 }
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> MV {
  var o: MV;
  var k = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  o.q = k[vi];
  let box = vec3f(56.0, 16.0, 56.0);
  let drift = vec3f(g.cam.w * 1.6, sin(g.cam.w * 0.4 + a.w * 30.0) * 0.4, g.cam.w * 0.3);
  let w = (fract(a.xyz + (drift - g.cam.xyz) / box) - 0.5) * box + g.cam.xyz;
  let d = distance(w, g.cam.xyz);
  let uvp = (w.xz + 0.5) / 2048.0;
  let s = textureSampleLevel(TNS, SL, uvp, 1.0);
  let x = textureSampleLevel(TX, SL, uvp, 0.0);
  let gh = textureLoad(TH, vec2i(floor(w.xz + 0.5)) & vec2i(2047), 0).r;
  let top = mix(x.x, x.y, g.amb.w) * (mix(s.z, s.w, g.amb.w) - g.sunc.w);
  let vis = smoothstep(top - 0.5, top + 2.0, w.y - gh) * cloudLight(w) * step(0.0, w.y - gh);
  let sz = 0.004 + 0.006 * a.w;
  let px = d * 0.0011;
  let mu = max(dot(normalize(w - g.cam.xyz), g.sun.xyz), 0.0);
  let tw = pow(0.5 + 0.5 * sin(g.cam.w * (0.8 + a.w * 2.2) + a.w * 90.0), 3.0);
  o.e = vis * min(1.0, sz / px) * min(1.0, sz / px) * smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(20.0, 27.0, d)) * (0.25 + 2.5 * mu * mu * mu * mu) * (0.3 + 0.7 * tw);
  o.p = g.vp * vec4f(w + (normalize(g.cr.xyz) * o.q.x + normalize(g.cu.xyz) * o.q.y) * max(sz, px), 1.0);
  return o;
}
@fragment fn fs(i: MV) -> @location(0) vec4f {
  return vec4f(min(g.sunc.rgb * g.sand.rgb * (i.e * exp(-dot(i.q, i.q) * 4.0) * 0.6), vec3f(8.0)), 1.0);
}
`;

// ---------------------------------------------------------------- dune grass
// Every blade is real geometry (a tapering strip, bent and swaying), so its edges anti-alias cleanly. Light passes
// through a blade: lit from behind it glows, and against a low sun it rims with light. Blades thin out to nothing
// before their draw distance ends, and are never narrower than a pixel.
const W_GRASS = W_SCENE + /*wgsl*/`
struct GV { @builtin(position) p: vec4f, @location(0) w: vec3f, @location(1) n: vec3f, @location(2) k: vec2f }
// a: root + height; b: direction it leans, how far it leans, width, seed
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> GV {
  var o: GV;
  var k = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = k[vi % 6u];
  let v = (f32(vi / 6u) + c.y) / 3.0;
  let wrap = round((g.cam.xz - a.xz) / 2048.0) * 2048.0;
  let base = vec3f(a.x + wrap.x, a.y, a.z + wrap.y);
  let dir = vec3f(cos(b.x), 0.0, sin(b.x));
  let sway = sin(g.cam.w * 2.1 + b.w * 40.0 + base.x * 0.35) * 0.07 + sin(g.cam.w * 3.7 + b.w * 17.0) * 0.03;
  let stem = base + vec3f(0.0, v * a.w * (1.0 - 0.3 * b.y * v), 0.0) + dir * (b.y * v * v * a.w) + vec3f(1.0, 0.0, 0.25) * (sway * v * v * a.w);
  let tang = normalize(vec3f(0.0, 1.0 - 0.6 * b.y * v, 0.0) + dir * (2.0 * b.y * v));
  let side = normalize(cross(tang, stem - g.cam.xyz));
  let d = distance(base, g.cam.xyz);
  let wd = max(b.z * (1.0 - v * 0.92), d * 0.001 * (1.0 - v)) * (1.0 - smoothstep(110.0, 170.0, d));
  o.w = stem + side * (c.x * wd * 0.5);
  o.n = cross(side, tang);
  o.k = vec2f(v, b.w);
  o.p = g.vp * vec4f(o.w, 1.0);
  if (d > 170.0) { o.p = vec4f(0.0, 0.0, -1.0, 1.0); }
  return o;
}
@fragment fn fs(i: GV) -> @location(0) vec4f {
  let uv = (i.w.xz + 0.5) / 2048.0;
  let s = textureSample(TNS, SL, uv);
  let open = textureSample(TX, SL, uv).z;
  let hz = mix(s.z, s.w, g.amb.w);
  let sh = smoothstep(hz - 0.02, hz + 0.035, g.sunc.w) * cloudLight(i.w);
  let V = normalize(g.cam.xyz - i.w);
  var n = normalize(i.n);
  n *= sign(dot(n, V) + 0.0001);
  let L = g.sun.xyz;
  let ndl = dot(n, L);
  // dry straw, darker and greyer toward the root
  let alb = mix(vec3f(0.11, 0.09, 0.05), vec3f(0.5, 0.42, 0.22), smoothstep(0.0, 0.8, i.k.x)) * (0.75 + 0.5 * i.k.y);
  let back = (max(-ndl, 0.0) * 0.85 + 0.15) * 0.7 * (1.0 + 1.2 * pow(max(dot(-V, L), 0.0), 3.0));
  let c = alb * 0.3183 * (g.sunc.rgb * sh * (max(ndl, 0.0) + back * vec3f(1.3, 1.2, 0.75)) + ambient(vec3f(0.0, 1.0, 0.0)) * open * open * (0.35 + 0.65 * i.k.x));
  return tone(fog(c, i.w), i.p.xy);
}
`;
