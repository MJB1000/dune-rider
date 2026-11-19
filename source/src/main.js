// ============================================================================
// renderer, camera, controls, dust, HUD
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), elStatus = $('s'), elBar = $('b'), elHud = $('i'), elGo = $('d'), body = document.body;
const fail = (msg) => { throw new Error(msg, { cause: 1 }); };
if (!navigator.gpu) fail('This game needs WebGPU. Open it in a recent Chrome, Edge or Safari.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU graphics adapter was found.');
const device = await adapter.requestDevice();
// the graphics driver gave up: come back a detail level lower, or on Low say what happened
device.lost.then((l) => { if (l.reason === 'destroyed') return; if (LV < 2) { keep('dune', LV + 1); location.reload(); } else { body.className = 'l e'; elStatus.textContent = 'The graphics device was lost. Reload the page.'; } });
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
// yields to the page between build steps; a message channel is not slowed down in a background tab the way timers are
const _mc = new MessageChannel(); let _mcr = null; _mc.port1.onmessage = () => { const r = _mcr; _mcr = null; if (r) r(); };
const tick = (f, msg) => { elBar.style.transform = `scaleX(${f})`; if (msg) elStatus.textContent = msg; return new Promise((r) => { _mcr = r; _mc.port2.postMessage(0); }); };
const AA = 4, HDR = 'rgba16float', TU = GPUTextureUsage, BU = GPUBufferUsage, VIS = GPUShaderStage;
device.pushErrorScope('validation');

// ---------------------------------------------------------------- world data -> GPU
// marks a load in progress (see LV in math.js); leaving the page before it ends is not a crash
keep('duneLoad', 1);
addEventListener('pagehide', () => { try { delete localStorage.duneLoad; } catch {} });
await tick(0.02, 'Lighting the sky…');
// the sky texture is redrawn by the GPU whenever the sun moves
const texSky = device.createTexture({ size: [SKW, SKH], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT }), viewSky = texSky.createView();
await tick(0.05, 'Piling up dunes…');
const { mips, tx } = await buildTerrain(tick);
await tick(0.94, 'Building the bike…');
// heights, plus 6 smoothed half-size copies for the coarser terrain patches (tent filter centred on each kept sample)
const texH = device.createTexture({ size: [TN, TN], format: 'r32float', mipLevelCount: 7, usage: TU.TEXTURE_BINDING | TU.COPY_DST });
for (let l = 0, n = TN, src = TH; l < 7; l++) {
  device.queue.writeTexture({ texture: texH, mipLevel: l }, src, { bytesPerRow: n * 4 }, [n, n]);
  const m = n >> 1, d = new Float32Array(m * m), w = [0.25, 0.5, 0.25];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let a = 0;
    for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) a += src[((i * 2 + u) & (n - 1)) + ((j * 2 + v) & (n - 1)) * n] * w[u + 1] * w[v + 1];
    d[i + j * m] = a;
  }
  n = m; src = d;
}
const texN = device.createTexture({ size: [TN, TN], format: 'rgba16float', mipLevelCount: mips.length, usage: TU.TEXTURE_BINDING | TU.COPY_DST });
for (let l = 0; l < mips.length; l++) device.queue.writeTexture({ texture: texN, mipLevel: l }, mips[l].d, { bytesPerRow: mips[l].n * 8 }, [mips[l].n, mips[l].n]);
mips.length = 0;
const texX = device.createTexture({ size: [HN, HN], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
device.queue.writeTexture({ texture: texX }, tx, { bytesPerRow: HN * 8 }, [HN, HN]);
// the baked sand relief (drawn into further down, once the pipelines exist)
const texD = device.createTexture({ size: [1024, 1024], format: 'rgba8unorm', mipLevelCount: 11, usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT });
const SMN = LV ? 1024 : 2048, texSM = device.createTexture({ size: [SMN, SMN], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING }), viewSM = texSM.createView();

const mkBuf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
const U = new Float32Array(80), UB = device.createBuffer({ size: U.byteLength, usage: BU.UNIFORM | BU.COPY_DST });

// terrain patch: 32 x 32 cells plus a skirt around the edge that hides the seams between detail levels
const GN = 32, gv = [], gi = [];
for (let j = 0; j <= GN; j++) for (let i = 0; i <= GN; i++) gv.push(i, j, 0);
for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const a = i + j * (GN + 1), b = a + 1, c = a + GN + 2, d = a + GN + 1; gi.push(a, b, c, a, c, d); }
for (const e of [(k) => [k, 0], (k) => [GN, k], (k) => [GN - k, GN], (k) => [0, GN - k]]) {
  const base = gv.length / 3;
  for (let k = 0; k <= GN; k++) { const [i, j] = e(k); gv.push(i, j, 1); }
  for (let k = 0; k < GN; k++) { const [i0, j0] = e(k), [i1, j1] = e(k + 1), a = i0 + j0 * (GN + 1), b = i1 + j1 * (GN + 1); gi.push(a, b, base + k + 1, a, base + k + 1, base + k); }
}
const gridVB = mkBuf(new Float32Array(gv), BU.VERTEX), gridIB = mkBuf(new Uint16Array(gi), BU.INDEX), gridN = gi.length;
const MAXN = 1024, NODES = new Float32Array(MAXN * 4), nodeVB = device.createBuffer({ size: NODES.byteLength, usage: BU.VERTEX | BU.COPY_DST });

// ---------------------------------------------------------------- pipelines
const lin = { magFilter: 'linear', minFilter: 'linear' };
const BGL_M = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VIS.VERTEX | VIS.FRAGMENT, buffer: {} },
  { binding: 1, visibility: VIS.VERTEX | VIS.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
  { binding: 2, visibility: VIS.VERTEX | VIS.FRAGMENT, texture: {} },
  { binding: 3, visibility: VIS.VERTEX | VIS.FRAGMENT, sampler: {} },
  { binding: 4, visibility: VIS.FRAGMENT, texture: {} },
  { binding: 5, visibility: VIS.FRAGMENT, sampler: {} },
  { binding: 6, visibility: VIS.FRAGMENT, texture: { sampleType: 'depth' } },
  { binding: 7, visibility: VIS.FRAGMENT, sampler: { type: 'comparison' } },
  { binding: 8, visibility: VIS.VERTEX | VIS.FRAGMENT, texture: {} },
  { binding: 9, visibility: VIS.FRAGMENT, texture: {} }] });
const BGL_S = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VIS.VERTEX | VIS.FRAGMENT, buffer: {} }] });
const BGL_P = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VIS.VERTEX, buffer: {} }] });
const bgM = device.createBindGroup({ layout: BGL_M, entries: [
  { binding: 0, resource: { buffer: UB } },
  { binding: 1, resource: texH.createView() },
  { binding: 2, resource: texN.createView() },
  { binding: 3, resource: device.createSampler({ ...lin, mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 }) },
  { binding: 4, resource: viewSky },
  { binding: 5, resource: device.createSampler({ ...lin, addressModeU: 'repeat' }) },
  { binding: 6, resource: viewSM },
  { binding: 7, resource: device.createSampler({ ...lin, compare: 'less' }) },
  { binding: 8, resource: texX.createView() },
  { binding: 9, resource: texD.createView() }] });
const bgS = device.createBindGroup({ layout: BGL_S, entries: [{ binding: 0, resource: { buffer: UB } }] });
const plM = device.createPipelineLayout({ bindGroupLayouts: [BGL_M] }), plMP = device.createPipelineLayout({ bindGroupLayouts: [BGL_M, BGL_P] });
const pipe = (layout, code, buffers, write, compare, blend) => {
  const m = device.createShaderModule({ code });
  return device.createRenderPipeline({
    layout, vertex: { module: m, entryPoint: 'vs', buffers }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: HDR, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: write, depthCompare: compare }, multisample: { count: AA },
  });
};
const VB_MESH = [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }] }];
const pTerrain = pipe(plM, W_TERRAIN, [
  { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
  { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] }], true, 'greater');
const pBike = pipe(plMP, W_BIKE, VB_MESH, true, 'greater');
const pSky = pipe(plM, W_SKY, [], false, 'greater-equal');
const pDust = pipe(plM, W_DUST, [{ arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }], false, 'greater',
  { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } });
const pTrack = pipe(plM, W_TRACK, [{ arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }], false, 'greater',
  { color: { srcFactor: 'zero', dstFactor: 'src' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } });
const pShadow = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [BGL_S, BGL_P] }),
  vertex: { module: device.createShaderModule({ code: W_SHADOW }), entryPoint: 'vs', buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
});

// stones and scrub, and the shadows they throw
const MULT = { color: { srcFactor: 'zero', dstFactor: 'src' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
const VB_INST = { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' }] };
const pProp = pipe(plM, W_PROP, [VB_MESH[0], VB_INST], true, 'greater');
const pPShadow = pipe(plM, W_PSHADOW, [{ arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }], false, 'greater', MULT);
const propData = buildProps(), PROPS = [['rock', 'rocks'], ['pebble', 'pebbles']].map(([m, i]) => ({ vb: mkBuf(propData[m].vb, BU.VERTEX), ib: mkBuf(propData[m].ib, BU.INDEX), n: propData[m].ib.length, inst: mkBuf(propData[i], BU.VERTEX), count: propData[i].length / 8 }));
const tuftVB = mkBuf(propData.tufts, BU.VERTEX), tuftN = propData.tufts.length / 8, bladeVB = mkBuf(propData.blades, BU.VERTEX), bladeN = propData.blades.length / 8;
const INST2 = [{ arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }];
const pGrass = pipe(plM, W_GRASS, INST2, true, 'greater');
// dust motes: fixed random points in a box that wraps around the camera
rseed(6);
const MOTES = [3500, 1800, 1][LV], moteD = new Float32Array(MOTES * 4); for (let i = 0; i < moteD.length; i++) moteD[i] = rnd();
const moteVB = mkBuf(moteD, BU.VERTEX);
const pMote = pipe(plM, W_MOTE, [{ arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }], false, 'greater', { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } });

// post chain: light shafts, their blur, bloom, composite
const BGL_D = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VIS.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } }] });
const fsPipe = (code, format, layout = 'auto', entry = 'fs', blend) => { const m = device.createShaderModule({ code }); return device.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: entry, targets: [{ format, blend }] } }); };
const pRays = fsPipe(W_RAYS, HDR, device.createPipelineLayout({ bindGroupLayouts: [BGL_M, BGL_D] })), pRB = fsPipe(W_RBLUR, HDR), pPost = fsPipe(W_POST, FMT);
const BGL_B = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VIS.FRAGMENT, texture: {} }, { binding: 1, visibility: VIS.FRAGMENT, sampler: {} }] }), plB = device.createPipelineLayout({ bindGroupLayouts: [BGL_B] });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pDown0 = fsPipe(W_BLIT, HDR, plB, 'fsDown0'), pDown = fsPipe(W_BLIT, HDR, plB, 'fsDown'), pUp = fsPipe(W_BLIT, HDR, plB, 'fsUp', ADD);
const sClamp = device.createSampler(lin);
// bake the sand relief once, then its smaller copies
{
  const pDetail = fsPipe(W_DETAIL, 'rgba8unorm'), pMip8 = fsPipe(W_BLIT, 'rgba8unorm', plB, 'fsMip'), sRep = device.createSampler({ ...lin, addressModeU: 'repeat', addressModeV: 'repeat' });
  const e = device.createCommandEncoder(), lv = (i) => texD.createView({ baseMipLevel: i, mipLevelCount: 1 });
  let r = e.beginRenderPass({ colorAttachments: [{ view: lv(0), loadOp: 'clear', storeOp: 'store' }] }); r.setPipeline(pDetail); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [{ view: lv(i), loadOp: 'clear', storeOp: 'store' }] }); r.setPipeline(pMip8);
    r.setBindGroup(0, device.createBindGroup({ layout: BGL_B, entries: [{ binding: 0, resource: lv(i - 1) }, { binding: 1, resource: sRep }] })); r.draw(3); r.end();
  }
  device.queue.submit([e.finish()]);
}

const mSB = device.createShaderModule({ code: W_SKYBAKE });
const pSkyBake = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [BGL_S] }), vertex: { module: mSB, entryPoint: 'vs' },
  fragment: { module: mSB, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' },
});

// bike parts: mesh, model matrix, its uniform buffer
const meshes = buildBike(), PARTS = ['chassis', 'forkU', 'forkL', 'wheelF', 'wheelR', 'torso', 'helmet', 'uarmL', 'uarmR', 'armL', 'armR', 'thighL', 'thighR', 'shinL', 'shinR', 'wingR1', 'wingR2', 'wingR3', 'finR', 'wingL1', 'wingL2', 'wingL3', 'finL', 'flameR', 'flameL', 'rudder', 'lowR1', 'lowR2', 'lowL1', 'lowL2'].map((name) => {
  const m = meshes[name], ub = device.createBuffer({ size: 64, usage: BU.UNIFORM | BU.COPY_DST });
  return { fx: /flame/.test(name), hide: /torso|helmet|uarm/.test(name), vb: mkBuf(m.vb, BU.VERTEX), ib: mkBuf(m.ib, BU.INDEX), n: m.ib.length, ub, mat: new Float32Array(16), bg: device.createBindGroup({ layout: BGL_P, entries: [{ binding: 0, resource: { buffer: ub } }] }) };
});
const [pChassis, pForkU, pForkL, pWheelF, pWheelR, pTorso, pHelmet, pUarmL, pUarmR, pArmL, pArmR, pThighL, pThighR, pShinL, pShinR] = PARTS, WINGS = [PARTS.slice(15, 19), PARTS.slice(19, 23)], pRudder = PARTS[25];
const verr = await device.popErrorScope();
if (verr) fail('Graphics setup failed: ' + verr.message);

// ---------------------------------------------------------------- dust
const DN = 1200, dG = new Float32Array(DN), dW = new Float32Array(DN), dA = new Float32Array(DN), dK = new Float32Array(DN), dP = new Float32Array(DN * 3), dV = new Float32Array(DN * 3), dL = new Float32Array(DN), dM = new Float32Array(DN), dS = new Float32Array(DN), dR = new Float32Array(DN);
const dI = new Float32Array(DN * 8), dustVB = device.createBuffer({ size: dI.byteLength, usage: BU.VERTEX | BU.COPY_DST });
let dNext = 0, dAcc = 0, rAcc = 0, dCount = 0;
// one particle: lift (+) or weight (-), how much it swells over its life, opacity, air drag.
// The defaults are a dust puff; roost grains are small, heavy and fly in an arc.
const puff = (x, y, z, vx, vy, vz, life, size, grav = 0.25, grow = 5.5, alpha = 0.5, drag = 1.7) => {
  const i = dNext; dNext = (dNext + 1) % DN; dG[i] = grav; dW[i] = grow; dA[i] = alpha; dK[i] = drag;
  dP[i * 3] = x; dP[i * 3 + 1] = y; dP[i * 3 + 2] = z; dV[i * 3] = vx; dV[i * 3 + 1] = vy; dV[i * 3 + 2] = vz; dL[i] = dM[i] = life; dS[i] = size; dR[i] = rnd();
};
function dustStep(dt) {
  dCount = 0;
  for (let i = 0; i < DN; i++) {
    if (dL[i] <= 0) continue;
    dL[i] -= dt; if (dL[i] <= 0) continue;
    const o = i * 3, k = exp(-dt * dK[i]);
    dV[o] = dV[o] * k + 0.9 * dt; dV[o + 1] = dV[o + 1] * k + dG[i] * dt; dV[o + 2] *= k;
    dP[o] += dV[o] * dt; dP[o + 1] += dV[o + 1] * dt; dP[o + 2] += dV[o + 2] * dt;
    const f = dL[i] / dM[i], q = dCount++ * 8, sz = dS[i] * (1 + dW[i] * (1 - f)), gy = heightAt(dP[o], dP[o + 2]) + sz * 0.75;
    if (dP[o + 1] < gy) { dP[o + 1] = gy; if (dG[i] < -2) dL[i] = min(dL[i], 0.08); } // grains stop where they land
    dI[q] = dP[o]; dI[q + 1] = dP[o + 1]; dI[q + 2] = dP[o + 2]; dI[q + 3] = sz;
    dI[q + 4] = dA[i] * f * min(1, (1 - f) * 5 + 0.08); dI[q + 5] = dR[i]; dI[q + 6] = shadowAt(dP[o], dP[o + 2]); dI[q + 7] = 0;
  }
}

// ---------------------------------------------------------------- tyre tracks: a ring buffer of short stretches laid where the wheels touch
const KN = 2400, kI = new Float32Array(KN * 8), trackVB = device.createBuffer({ size: kI.byteLength, usage: BU.VERTEX | BU.COPY_DST });
let kNext = 0, kUsed = 0;
const TRK = [{ x: 0, y: 0, z: 0, on: 0 }, { x: 0, y: 0, z: 0, on: 0 }];
// wheel w (0 rear, 1 front) is at (x, z); lay track from where it last was
function track(w, x, z, down, half, strength) {
  const t = TRK[w];
  if (!down) { t.on = 0; return; }
  const y = heightAt(x, z);
  if (!t.on) { t.x = x; t.y = y; t.z = z; t.on = 1; return; }
  if (hypot(x - t.x, z - t.z) < 0.3) return;
  const o = kNext * 8; kNext = (kNext + 1) % KN; if (kUsed < KN) kUsed++;
  kI[o] = t.x; kI[o + 1] = t.y; kI[o + 2] = t.z; kI[o + 3] = half; kI[o + 4] = x; kI[o + 5] = y; kI[o + 6] = z; kI[o + 7] = strength;
  device.queue.writeBuffer(trackVB, o * 4, kI, o, 8);
  t.x = x; t.y = y; t.z = z;
}

// ---------------------------------------------------------------- terrain detail levels
// A quadtree over the endless tiling: 1 m cells near the camera, doubling with distance out to about 7 km.
let nNodes = 0;
const QS = new Float32Array(3 * 512);
function selectNodes(cx, cz, fx, fz) {
  nNodes = 0; let sp = 0;
  const R0 = 2048, bx = floor(cx / R0), bz = floor(cz / R0);
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { QS[sp++] = (bx + i) * R0; QS[sp++] = (bz + j) * R0; QS[sp++] = R0; }
  while (sp > 0) {
    const s = QS[--sp], z = QS[--sp], x = QS[--sp];
    const dx = max(x - cx, 0, cx - x - s), dz = max(z - cz, 0, cz - z - s), d = hypot(dx, dz);
    if (s > GN && d < s * 1.5) {
      const h = s / 2;
      QS[sp++] = x; QS[sp++] = z; QS[sp++] = h; QS[sp++] = x + h; QS[sp++] = z; QS[sp++] = h;
      QS[sp++] = x; QS[sp++] = z + h; QS[sp++] = h; QS[sp++] = x + h; QS[sp++] = z + h; QS[sp++] = h;
    } else {
      // wholly behind the camera
      if (d > 30 && (x + s / 2 - cx) * fx + (z + s / 2 - cz) * fz < -s * 0.8 - 30) continue;
      if (nNodes >= MAXN) continue;
      const o = nNodes++ * 4; NODES[o] = x; NODES[o + 1] = z; NODES[o + 2] = s / GN; NODES[o + 3] = 0;
    }
  }
}

// ---------------------------------------------------------------- render targets
// The scene is drawn at `pix` pixels into a high-range target and scaled up to the window; frame() lowers `pix`
// when frames run long and raises it again when there is room (the governor Abyssal Garden uses, simplified).
const NB = 6, PIXMAX = [2560 * 1440, 1920 * 1080, 1280 * 720][LV], PIXMIN = 4e5;
let RW = 0, RH = 0, pix = PIXMAX, targets = [], passScene, passRays, passBlur, passPost, bgDepth, bgBlur, bgPost, bloomPass = [], bloomBG = [];
let dynT = 0, dynN = 0, dynBad = 0, dynOk = 0, dynWait = 3, refMs = 40; // refMs: the display's own frame interval, learned as the fastest average seen
const tex = (w, h, format, usage, sampleCount = 1) => device.createTexture({ size: [w, h], format, usage, sampleCount });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });
function resize() {
  const dpr = min(devicePixelRatio || 1, 2), dw = max(2, round(canvas.clientWidth * dpr)), dh = max(2, round(canvas.clientHeight * dpr));
  const s = min(1, sqrt(pix / (dw * dh))), w = max(2, round(dw * s) & ~1), h = max(2, round(dh * s) & ~1);
  if (w === RW && h === RH) return;
  RW = canvas.width = w; RH = canvas.height = h;
  for (const t of targets) t.destroy();
  const RA = TU.RENDER_ATTACHMENT, RT = RA | TU.TEXTURE_BINDING;
  const tMS = tex(w, h, HDR, RA, AA), tDp = tex(w, h, 'depth32float', RT, AA), tRes = tex(w, h, HDR, RT), tRay = tex(w / 2, h / 2, HDR, RT), tRay2 = tex(w / 2, h / 2, HDR, RT);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, w >> (i + 1)), max(1, h >> (i + 1)), HDR, RT); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  passScene = { colorAttachments: [{ view: tMS.createView(), resolveTarget: vRes, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] }; passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgDepth = device.createBindGroup({ layout: BGL_D, entries: [{ binding: 0, resource: vDp }] });
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: UB } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  // bloom: down res -> b0 -> ... -> b5, then up b5 -> b4 ... -> b0, adding
  const blitBG = (view) => device.createBindGroup({ layout: BGL_B, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
  bloomPass = []; bloomBG = [];
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
}

// ---------------------------------------------------------------- start position, camera, controls
// start at the upwind end of the longest straight run of pan, facing down it: room to get up to speed before the dunes
let spX = 300, spZ = 300, spBest = 0;
for (let z = 0; z < TILE; z += 16) { let run = 0; for (let x = 0; x < TILE * 2; x += 8) { if (panAt(x, z) > 0.98) { run += 8; if (run > spBest) { spBest = run; spX = x - run + 30; spZ = z; } } else run = 0; } }
for (let k = 0; k < 20 && kickH(spX, spZ) + kickH(spX + 12, spZ) > 0; k++) spX += 10; // not parked on a kicker
resetBike(spX, spZ, PI / 2);
// ---- landmarks: placed by rule so every world has all five. The mast stands on high ground, the rest on pans,
// each well clear of the others and of the start. The world repeats, so each is drawn at its nearest copy.
const wrapT = (d) => d - round(d / TILE) * TILE;
const LM = buildLandmarks().map((l) => {
  const ub = device.createBuffer({ size: 64, usage: BU.UNIFORM | BU.COPY_DST });
  return { ...l, x: 0, y: 0, z: 0, yaw: 0, wx: 0, wz: 0, buzz: 0, vb: mkBuf(l.mesh.vb, BU.VERTEX), ib: mkBuf(l.mesh.ib, BU.INDEX), n: l.mesh.ib.length, ub, mat: new Float32Array(16), bg: device.createBindGroup({ layout: BGL_P, entries: [{ binding: 0, resource: { buffer: ub } }] }) };
});
{
  let hi = 0; for (let z = 0; z < TILE; z += 32) for (let x = 0; x < TILE; x += 32) hi = max(hi, heightAt(x, z));
  rseed(77);
  LM.forEach((l, i) => {
    let bx = 0, bz = 0;
    for (let t = 0; t < 6000; t++) {
      const x = rnd() * TILE, z = rnd() * TILE; bx = x; bz = z;
      if ((l.site === 'high' ? heightAt(x, z) > hi * 0.82 : panAt(x, z) > 0.98 && panAt(x + 20, z) > 0.98 && panAt(x - 20, z) > 0.98 && kickH(x, z) + kickH(x + 30, z) + kickH(x - 30, z) + kickH(x, z + 30) + kickH(x, z - 30) === 0) && hypot(wrapT(x - spX), wrapT(z - spZ)) > 140 && LM.every((o, j) => j >= i || hypot(wrapT(x - o.x), wrapT(z - o.z)) > 260)) break;
    }
    l.x = bx; l.z = bz; l.y = heightAt(bx, bz); l.yaw = rnd() * TAU;
  });
}
const CAM = { x: B.x - 7, y: B.y + 2.5, z: B.z, yaw: PI / 2 + 0.6 };
let playing = false, tLast = performance.now(), tNow = 0, acc = 0, hudT = 0, airMax = 0, airShow = 0, airText = '', bikeSh = 1, score = 0, bestAir = 0, benching = false, benchT = 0, benchDone = null, fT = -1, fW = 0, fF = 0, fTemp = 0, camDrop = 0, camDropV = 0, shk = 0, finUp = 0, prox = 0, proxD = -1, bones = 0, wasBones = 0, devAcc = 0, cdAcc = 0;
try { bones = +localStorage.duneBones || 0; } catch {}
try { bestAir = +localStorage.duneBestAir || 0; } catch {}
const elScore = $('j'), elFuel = $('n'), elFuelBox = $('o'), benchF = [];
const STEP = 1 / 240, K = {};
// first-person view by default; the clock starts at the player's local time
const d0 = new Date(), RATES = [60, 600, 0, 1], RATE_NAMES = ['1 hour a minute', '1 hour every 6 s', 'time paused', 'real time'];
let pov = true, hour = d0.getHours() + d0.getMinutes() / 60, tRate = 0, skyHour = -99, skyDirty = true, expo = -1, camPitch = 0, camRoll = 0, noteT = 0, note = '';
let dbgFov = 0; // set from the console (DUNE.fov) for a telephoto look at the bike
const say = (t) => { note = '   ' + t; noteT = 2.5; };
// ---- progression. Air time landed cleanly is the currency. The running total opens the kit, in order; the bank is
// spent on upgrades. Finding a landmark pays a bonus into both. Kept in the browser between visits.
const SAVE = { bank: 0, total: 0, up: [0, 0, 0, 0, 0], found: 0, daily: 0, best: 0 };
try { Object.assign(SAVE, JSON.parse(localStorage.duneSave || '{}')); } catch {}
const saveNow = () => keep('duneSave', JSON.stringify(SAVE));
const KIT = [[2, 'ROCKET BOOST', 'hold Shift'], [25, 'WINGS', 'tap F'], [60, 'TAIL FIN', 'Q and E in the air'], [150, 'SECOND WINGS', 'tap F twice']];
const has = (i) => FREE || SAVE.total >= KIT[i][0];
const UPG = [['Boost tank', 'longer burn'], ['Wing spars', 'tips fold later'], ['Suspension', 'harder landings'], ['Engine', 'more power'], ['Paddle tyres', 'loose sand']], COST = [20, 50, 120];
const applyUp = () => { const u = SAVE.up; BK.burn = [3, 3.6, 4.2, 5][u[0]]; BK.gmax = [2.7, 3.1, 3.5, 4][u[1]]; BK.hard = [26, 29, 32, 36][u[2]]; BK.P = 27000 * (1 + 0.08 * u[3]); BK.Fmax = 1500 * (1 + 0.08 * u[3]); BK.softK = [1, 0.7, 0.4, 0.1][u[4]]; };
applyUp();
let bigT = 0, bigText = '', trick = 0, nRoll = 0, nLoop = 0, nSpin = 0, smT = 0, tapD = 0, tapT = 0, camLp = 0, pPrev = 0;
const big = (t) => { bigText = t; bigT = 5; };
const earn = (sec) => { const was = SAVE.total; SAVE.bank += sec; SAVE.total += sec; for (const k of KIT) if (was < k[0] && SAVE.total >= k[0] && !FREE) big('UNLOCKED: ' + k[1] + '  (' + k[2] + ')'); saveNow(); };
const buy = (i) => { const lv = SAVE.up[i]; if (lv > 2 || SAVE.bank < COST[lv]) return; SAVE.bank -= COST[lv]; SAVE.up[i] = lv + 1; applyUp(); saveNow(); shop(); };
// ---- Daily Dune: a three-minute scored run over today's dunes
const RUN = 180; let runT = DAILY ? RUN : 0, runDone = false, runFound = 0;
const elShop = $('u'), elDaily = $('dy');
function shop() {
  const nx = KIT.find((k, i) => !has(i));
  let h = (DAILY ? '<p><b>DAILY DUNE</b> &nbsp; three minutes on today&rsquo;s dunes, the same for everyone' + (SAVE.daily === DAY ? ' &nbsp; best today ' + SAVE.best : '') + (runDone ? '<br><b>Run over: ' + score + ' points</b>' : '') + '</p>' : '')
    + '<p><b>AIR BANK ' + SAVE.bank.toFixed(1) + ' s</b> &nbsp; ' + (FREE ? 'free play: everything open' : nx ? 'next: ' + nx[1] + ' at ' + nx[0] + ' s landed (' + SAVE.total.toFixed(0) + ' so far)' : 'whole kit unlocked') + '</p><p>';
  UPG.forEach((u, i) => { const lv = SAVE.up[i]; h += '<button data-u=' + i + (lv > 2 || SAVE.bank < COST[lv] ? ' disabled' : '') + '><i>' + (i + 1) + '</i> ' + u[0] + ' ' + '\u25ae'.repeat(lv) + '\u25af'.repeat(3 - lv) + (lv > 2 ? '' : ' &nbsp;' + COST[lv] + ' s') + '</button>'; });
  elShop.innerHTML = h + '</p>';
  for (const b of elShop.querySelectorAll('[data-u]')) b.onclick = () => buy(+b.dataset.u);
  // touch buttons for kit not yet earned stay off the screen
  $('to').style.display = has(0) ? '' : 'none'; $('tw').style.display = has(1) ? '' : 'none'; $('tq').style.display = $('te').style.display = has(2) ? '' : 'none';
}
elDaily.textContent = DAILY ? 'Home dunes' : 'Daily Dune';
elDaily.onclick = () => { location.href = location.pathname + (DAILY ? '' : '?daily'); };
shop();
const pause = () => { playing = false; body.className = 'm'; elGo.textContent = runDone ? 'Run again' : 'Resume'; shop(); };
elGo.onclick = () => {
  sound(); playing = true; body.className = 'g'; elGo.blur();
  if (runDone) { runDone = false; runT = RUN; score = 0; runFound = 0; prox = 0; resetBike(spX, spZ, PI / 2); }
  // on a phone, fill the screen and hold it sideways where the browser allows
  if (touchUI) { try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {}); } catch {} }
};
// ---- touch controls. The buttons press the same keys the keyboard does, so everything behind them is shared:
// the left thumb has a stick (sideways steers, up and down shifts the rider's weight), the right has the rest.
let touchUI = false, tSteer = 0, tLean = 0;
const touchOn = () => { if (touchUI) return; touchUI = true; document.documentElement.classList.add('t'); };
if (TOUCH) touchOn(); else addEventListener('touchstart', touchOn, { once: true, passive: true });
for (const b of document.querySelectorAll('[data-k]')) {
  const code = b.dataset.k, set = (d) => { if ((b.className === 'on') === d) return; b.className = d ? 'on' : ''; dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code })); };
  b.onpointerdown = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {} set(true); };
  b.onpointerup = b.onpointercancel = b.onlostpointercapture = () => set(false);
}
{
  const pad = $('ts'), nub = $('tn'); let id = -1, ox = 0, oy = 0;
  const move = (e) => { const r = pad.clientWidth * 0.3, dx = clamp((e.clientX - ox) / r, -1, 1), dy = clamp((e.clientY - oy) / r, -1, 1); tSteer = abs(dx) < 0.12 ? 0 : dx; tLean = abs(dy) < 0.45 ? 0 : -dy; nub.style.transform = 'translate(' + (dx * r).toFixed(0) + 'px,' + (dy * r).toFixed(0) + 'px)'; };
  pad.onpointerdown = (e) => { e.preventDefault(); id = e.pointerId; try { pad.setPointerCapture(id); } catch {} const q = pad.getBoundingClientRect(); ox = q.left + q.width / 2; oy = q.top + q.height / 2; move(e); };
  pad.onpointermove = (e) => { if (e.pointerId === id) move(e); };
  pad.onpointerup = pad.onpointercancel = pad.onlostpointercapture = () => { id = -1; tSteer = tLean = 0; nub.style.transform = ''; };
}
addEventListener('keydown', (e) => {
  K[e.code] = 1;
  // a double tap left or right asks for a trick: a barrel roll with the wings out, a flat 360 with them away
  if (!e.repeat && playing) { const d = e.code === 'KeyA' || e.code === 'ArrowLeft' ? -1 : e.code === 'KeyD' || e.code === 'ArrowRight' ? 1 : 0; if (d) { const n = performance.now(); if (d === tapD && n - tapT < 260) { IN.trick = d; tapT = 0; } else { tapD = d; tapT = n; } } }
  if (e.code === 'Escape' && playing) pause();
  else if (e.code === 'Enter' && !playing && body.className === 'm') elGo.onclick();
  else if (!playing && body.className === 'm' && /^Digit[1-5]$/.test(e.code)) buy(+e.code[5] - 1);
  else if (e.code === 'KeyR' && playing) resetBike(B.x, B.z, B.yaw);
  else if (e.code === 'KeyF' && playing && !e.repeat && B.crash <= 0) {
    // a tap steps through: no wings, main wings, main and lower wings, no wings. Held, it is a momentary switch:
    // wings out for as long as it is down if they were away; pulled in for a dive for as long as it is down if they were out.
    if (!has(1)) { say('wings: land ' + Math.ceil(KIT[1][0] - SAVE.total) + ' s more air to unlock'); return; }
    fT = performance.now(); fW = B.wingOn; fF = B.flapOn; fTemp = 0;
    if (!fW) { B.wingOn = 1; B.flapOn = 0; soundWings(1); say('wings out'); }
  }
  else if (e.code === 'KeyM') muted = !muted;
  else if ((e.code === 'KeyZ' || e.code === 'KeyX') && playing) { B.trim = clamp(B.trim + (e.code === 'KeyZ' ? 0.012 : -0.012), -0.084, 0.108); say('trim ' + (B.trim > 0.001 ? 'nose up ' : B.trim < -0.001 ? 'nose down ' : 'level ') + abs(round(B.trim / 0.012))); }
  else if (e.code === 'KeyC') { pov = !pov; say(pov ? 'rider view' : 'chase view'); }
  else if (e.code === 'KeyT') { tRate = (tRate + 1) % RATES.length; say(RATE_NAMES[tRate]); }
  else if (e.code === 'BracketRight') hour = (hour + 1) % 24;
  else if (e.code === 'BracketLeft') hour = (hour + 23) % 24;
  if (playing && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
});
addEventListener('keyup', (e) => {
  K[e.code] = 0;
  if (e.code === 'KeyF' && fT >= 0) {
    const held = performance.now() - fT; fT = -1;
    if (!playing || B.crash > 0) return;
    if (!fW) { if (held > 300) { B.wingOn = 0; B.flapOn = 0; soundWings(0); say('wings away'); } }            // was away: a hold puts them back, a tap leaves the main wings out
    else if (fTemp) say('wings spread');                                                                         // was out and held: that was a dive, they spread again
    else if (!fF && has(3)) { B.flapOn = 1; soundWings(1); say('second wings out'); }                                     // tap with the main wings out: add the lower pair
    else { B.wingOn = 0; B.flapOn = 0; soundWings(0); say('wings away'); }                                      // tap with both out: all away
  }
});
addEventListener('blur', () => { fT = -1; for (const k in K) K[k] = 0; if (playing) pause(); });
function readInput() {
  // F held past a fifth of a second with the wings out: pull them in and dive for as long as it stays down
  if (fT >= 0 && fW && !fTemp && performance.now() - fT > 220 && B.crash <= 0) { fTemp = 1; say('dive (hold F)'); }
  IN.tuck = fT >= 0 && fTemp && B.wingOn ? 1 : 0;
  let thr = K.KeyW || K.ArrowUp ? 1 : 0, brk = K.KeyS || K.ArrowDown || K.Space ? 1 : 0, st = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (gp) {
    thr = max(thr, gp.buttons[7] ? gp.buttons[7].value : 0); brk = max(brk, gp.buttons[6] ? gp.buttons[6].value : 0);
    if (abs(gp.axes[0]) > 0.12) st = clamp(st + gp.axes[0], -1, 1);
  }
  st = clamp(st + tSteer, -1, 1);
  IN.thr = thr; IN.brk = brk; IN.steer = st;
  // rider weight: I forward, K back; the right stick on a gamepad
  IN.lean = clamp((K.KeyI ? 1 : 0) - (K.KeyK ? 1 : 0) + (gp && abs(gp.axes[3]) > 0.2 ? -gp.axes[3] : 0) + tLean, -1, 1);
  // tail fin: Q swings the nose left, E right; the shoulder buttons on a gamepad
  IN.yaw = clamp((K.KeyE ? 1 : 0) - (K.KeyQ ? 1 : 0) + (gp ? (gp.buttons[5] && gp.buttons[5].pressed ? 1 : 0) - (gp.buttons[4] && gp.buttons[4].pressed ? 1 : 0) : 0), -1, 1);
  IN.grab = (K.KeyQ && K.KeyE) || (gp && gp.buttons[4] && gp.buttons[4].pressed && gp.buttons[5] && gp.buttons[5].pressed) ? 1 : 0; // both fin keys: superman
  IN.boost = has(0) && (K.ShiftLeft || K.ShiftRight || (gp && gp.buttons[0] && gp.buttons[0].pressed)) ? 1 : 0;
  if (!has(2)) IN.yaw = 0;
  if (benching) {
    // the scripted ride: flat out, weaving, a boost and a glide, half in each view
    const w = sin(benchT * 0.9); IN.thr = B.wingOn ? 0 : 1; IN.brk = 0; IN.steer = w > 0.6 ? 1 : w < -0.6 ? -1 : 0;
    IN.boost = (benchT > 6 && benchT < 8) || (benchT > 17 && benchT < 19) ? 1 : 0; IN.yaw = 0; IN.lean = 0; IN.tuck = 0; B.wingOn = B.air > 0.5 ? 1 : B.air === 0 ? 0 : B.wingOn; pov = benchT < 15;
  }
}

const MB = new Float32Array(16), MT = new Float32Array(16), MT2 = new Float32Array(16), MT3 = new Float32Array(16);
const MW1 = new Float32Array(16), MW2 = new Float32Array(16), MW3 = new Float32Array(16), MW4 = new Float32Array(16);
// ---- rider posing
const MR = new Float32Array(16), JT = [0, 0, 0];
let rStand = 0, rBack = 0, rCrouch = 0, rough = 0, cFp = 0, cRp = 0;
// two-bone joint: from root R to target T with bone lengths a and b, bending toward the pole direction; result in JT
function ik(rx, ry, rz, tx, ty, tz, a, b, px, py, pz) {
  let dx = tx - rx, dy = ty - ry, dz = tz - rz; const d0 = hypot(dx, dy, dz) || 1e-3, d = clamp(d0, abs(a - b) + 0.01, a + b - 0.005);
  dx /= d0; dy /= d0; dz /= d0;
  const ca = (a * a + d * d - b * b) / (2 * a * d), al = a * ca, h = a * sqrt(max(1 - ca * ca, 0)), k = px * dx + py * dy + pz * dz;
  let qx = px - dx * k, qy = py - dy * k, qz = pz - dz * k; const ql = 1 / (hypot(qx, qy, qz) || 1);
  JT[0] = rx + dx * al + qx * ql * h; JT[1] = ry + dy * al + qy * ql * h; JT[2] = rz + dz * al + qz * ql * h;
}
// stretch a unit limb segment from (x0,y0,z0) to (x1,y1,z1), in the frame `base`
function seg(part, base, x0, y0, z0, x1, y1, z1) {
  const fx = x1 - x0, fy = y1 - y0, fz = z1 - z0; let l = hypot(fx, fz), rx = 1, rz = 0;
  if (l > 1e-4) { rx = fz / l; rz = -fx / l; }
  let ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx; l = 1 / (hypot(ux, uy, uz) || 1);
  mBasis(MT3, rx, 0, rz, ux * l, uy * l, uz * l, fx, fy, fz, x0, y0, z0); mMul(part.mat, base, MT3);
}
const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - tLast, dt = min(dtr / 1000, 0.05); tLast = now; tNow += dt;
  // hold the frame rate: slow for two seconds running means fewer pixels; smooth for a while means try more
  // (it runs behind the menu too, on a shorter cycle, so the picture has settled before the ride starts)
  if (dtr < 200 && !benching && (dynT += dtr, ++dynN, dynT > (playing ? 1000 : 400))) {
    const a = dynT / dynN; let k = 1;
    // "slow" means slower than both 60 fps and the display itself: a 50 Hz screen running at 50 is not slow
    refMs = min(refMs + 0.02, a);
    if (a > max(17.6, refMs * 1.15)) { dynOk = 0; if (++dynBad > 1) { k = max(0.6, 15 / a); dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    else { dynBad = 0; if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    pix = clamp(pix * k, PIXMIN, PIXMAX); dynT = dynN = 0;
  }
  resize();
  if (playing) readInput(); else { IN.thr = 0; IN.steer = 0; IN.brk = 1; IN.boost = 0; }
  if (benching) { benchF.push(dtr); benchT += dt; if (benchT > 30 && benchDone) { const d = benchDone; benchDone = null; d(); } }
  acc += dt; while (acc >= STEP) { stepBike(STEP); acc -= STEP; }
  soundUpdate(dt, playing);

  // ---- time of day: move the sun, relight, adapt the exposure like an eye or a camera would
  if (RATES[tRate]) hour = (hour + dt * RATES[tRate] / 3600) % 24;
  if (abs(hour - skyHour) > 1e-4) { skyHour = hour; setSun(hour); skyLight(); skyDirty = true; }
  const sunUp = max(SUN[1], 0.38), lum = (0.2126 * SAND[0] * (SUNC[0] * sunUp + AMB[0]) + 0.7152 * SAND[1] * (SUNC[1] * sunUp + AMB[1]) + 0.0722 * SAND[2] * (SUNC[2] * sunUp + AMB[2])) / PI;
  const expoT = min(8, 0.34 / lum * pow(lum / 0.9, 0.15));
  expo = expo < 0 ? expoT : expo + (expoT - expo) * min(1, dt * 2.5);
  const night = 1 - sstep(-0.1, 0.02, SUN[1]);

  // ---- bike basis
  const sy = sin(B.yaw), cy = cos(B.yaw), sp = sin(B.pitch), cp = cos(B.pitch);
  const fX = sy * cp, fY = sp, fZ = cy * cp, uX = -sy * sp, uY = cp, uZ = -cy * sp, rX = cy, rZ = -sy;
  // lean about the tyre contact line; lying on its side after a crash
  const ln = B.crash > 0 ? 1.35 * min(1, B.ct * 5) * (B.lean < 0 ? -1 : 1) : B.lean + B.roll, cl = cos(ln), sl = sin(ln), hc = 0.67;
  const u2X = uX * cl + rX * sl, u2Y = uY * cl, u2Z = uZ * cl + rZ * sl, r2X = rX * cl - uX * sl, r2Y = -uY * sl, r2Z = rZ * cl - uZ * sl;
  mBasis(MB, r2X, r2Y, r2Z, u2X, u2Y, u2Z, fX, fY, fZ, B.x + hc * (u2X - uX), B.y + hc * (u2Y - uY), B.z + hc * (u2Z - uZ));
  pChassis.mat.set(MB);
  mRot(MT, FAX[0], FAX[1], FAX[2], B.steer, HEAD[0], HEAD[1], HEAD[2], 0, 0, 0); mMul(pForkU.mat, MB, MT);
  // ---- wings. Each side unfolds in order: the root section flips up and out from the front of the bike, then the
  // middle and tip sections open like a folding rule. The tail fins swing up off the rear fender.
  {
    const wg = max(0, B.wing - 0.12 * B.tk), e1 = sstep(0, 0.5, wg), e2 = sstep(0.28, 0.68, wg), e3 = sstep(0.35, 0.8, wg), e4 = sstep(0.55, 1, wg) * (1 - 0.93 * B.fold); // (overloaded, the tip sections fold back)
    for (let k = 0; k < 2; k++) {
      const sd = k ? -1 : 1, W = WINGS[k];
      // root section: stowed it hangs beside the front wheel like a leg shield; it flips up and out from a hinge on
      // the frame just behind the steering head, swept a little forward so the rider sees the wings ahead of him
      mRot(MW3, 0, 1, 0, -sd * 0.22 * e1, 0, 0, 0, sd * 0.25, 0.3, 0.52);
      mRot(MW2, 0, 0, 1, sd * (0.08 * e1 - 1.5708 * (1 - e1)), 0, 0, 0, 0, 0, 0); mMul(MW1, MW3, MW2); mMul(W[0].mat, MB, MW1);
      mRot(MW2, 0, 0, 1, sd * 3.08 * (1 - e3), 0, 0, 0, sd * 0.8, 0.04, 0); mMul(MW3, MW1, MW2); mMul(W[1].mat, MB, MW3);
      mRot(MW2, 0, 0, 1, -sd * 3.08 * (1 - e4), 0, 0, 0, sd * 0.9, -0.04, 0); mMul(MW4, MW3, MW2); mMul(W[2].mat, MB, MW4);
      mRot(MW1, 0, 1, 0, sd * mix(1.5708, 0.5, e1), 0, 0, 0, sd * 0.085, 0.41, -0.98);
      mRot(MW2, 0, 0, 1, sd * 0.75 * e2, 0, 0, 0, 0, 0, 0); mMul(MW3, MW1, MW2);
      mRot(MW2, 1, 0, 0, 1.5708 * (1 - e2), 0, 0, 0, 0, 0, 0); mMul(MW1, MW3, MW2); mMul(W[3].mat, MB, MW1);
    }
  }
  // ---- lower wings: stowed they lie back beside the rear wheel with the tip section folded over; they swing forward and out, then the tip opens
  {
    const e1 = sstep(0, 0.6, B.flap), e2 = sstep(0.4, 1, B.flap) * (1 - 0.93 * B.fold);
    for (let k = 0; k < 2; k++) {
      const sd = k ? -1 : 1;
      mRot(MW1, 0, 1, 0, sd * (1.5708 * (1 - e1) + 0.1 * e1), 0, 0, 0, sd * 0.2, -0.02, -0.22);
      mRot(MW2, 0, 0, 1, -sd * 0.07 * e1, 0, 0, 0, 0, 0, 0); mMul(MW3, MW1, MW2); mMul(PARTS[26 + k * 2].mat, MB, MW3);
      mRot(MW2, 0, 0, 1, sd * 3.08 * (1 - e2), 0, 0, 0, sd * 0.7, 0.04, 0); mMul(MW1, MW3, MW2); mMul(PARTS[27 + k * 2].mat, MB, MW1);
    }
  }
  // ---- tail fin: lies back along the rear fender on the ground, stands up once the bike is in the air, and swings with the rudder
  finUp += clamp((B.air > 0.12 || B.wdep > 0.3 ? 1 : 0) - finUp, -dt * 3, dt * 5);
  mRot(MW1, 0, 0, 1, 1.5708, 0, 0, 0, 0, 0.44, -1.0);
  mRot(MW2, 0, 1, 0, -B.wy * 0.55, 0, 0.44, -0.86, 0, 0, 0); mMul(MW3, MW2, MW1);
  mRot(MW2, 1, 0, 0, -1.32 * (1 - sstep(0, 1, finUp)), 0, 0.44, -0.86, 0, 0, 0); mMul(MW1, MW2, MW3); mMul(pRudder.mat, MB, MW1);
  // ---- rocket flames: stretched with the thrust, with a flutter in their length
  for (let k = 0; k < 2; k++) {
    const len = B.bst * (0.95 + 0.25 * sin(tNow * 47 + k * 2.1) + 0.1 * sin(tNow * 113));
    mBasis(MW1, 1, 0, 0, 0, 1, 0, 0, 0, max(len, 0.001), (k ? -1 : 1) * NOZ[0], NOZ[1], NOZ[2]); mMul(PARTS[23 + k].mat, MB, MW1);
  }
  // ---- rider: how he sits follows what the bike is doing
  const crashed = B.crash > 0;
  rough += (min(1, abs(B.q) * 0.5 + (abs(B.cF - cFp) + abs(B.cR - cRp)) / max(dt, 0.004) * 0.35) - rough) * min(1, dt * 3); cFp = B.cF; cRp = B.cR;
  // up on the pegs over rough ground, at speed and in the air; down in the seat for turns
  const standT = B.air > 0.05 ? 1 : clamp(sstep(0.1, 0.45, rough) + sstep(13, 26, B.speed) * 0.6 - sstep(0.2, 0.5, abs(B.lean)) * 0.8, 0, 1);
  rStand += (standT - rStand) * min(1, dt * 4);
  // weight back on drops and under braking, forward under power
  rBack += (clamp(-B.pitch * 1.1 + IN.brk * 0.5 - B.thr * 0.35 + (B.air > 0.2 ? 0.25 : 0) - IN.lean * 0.6, -0.6, 1) - rBack) * min(1, dt * 5);
  // legs soak up a landing
  if (min(B.land, 1) > rCrouch) rCrouch = min(B.land, 1);
  if (B.pre * 0.8 > rCrouch) rCrouch = B.pre * 0.8; // winding up for a jump
  rCrouch *= exp(-dt * 3.2);
  let RB = MB, pY = 0.44 + 0.13 * rStand - 0.11 * rCrouch, pZ = -0.31 + 0.11 * rStand - 0.13 * rBack, phi = 0.74 - 0.2 * rStand + 0.15 * rBack + 0.12 * rCrouch, rl = -(ln - B.roll) * 0.4;
  // superman: hands on the bars, everything else trailing out flat behind them
  if (B.sm > 0) { pY = mix(pY, 0.74, B.sm); pZ = mix(pZ, -0.41, B.sm); phi = mix(phi, 1.3, B.sm); }
  if (crashed) {
    // thrown clear and tumbling head over heels along the way he is going
    const ry = sin(RD.yaw), rc = cos(RD.yaw), ca = cos(RD.a), sa = sin(RD.a), Ux = ry * ca, Uy = sa, Uz = rc * ca, Fx = ry * sa, Fy = -ca, Fz = rc * sa;
    mBasis(MR, rc, 0, -ry, Ux, Uy, Uz, Fx, Fy, Fz, RD.x - Ux * 0.7 - Fx * 0.1, RD.y - Uy * 0.7 - Fy * 0.1, RD.z - Uz * 0.7 - Fz * 0.1);
    RB = MR; pY = 0.44; pZ = -0.31; phi = 0.12; rl = 0;
  }
  // spine direction, then a right and forward axis square to it
  let sx = sin(rl), sy2 = cos(phi), sz = sin(phi), il = 1 / hypot(sx, sy2, sz); sx *= il; sy2 *= il; sz *= il;
  let tx0 = 1 - sx * sx, ty0 = -sx * sy2, tz0 = -sx * sz; il = 1 / hypot(tx0, ty0, tz0); tx0 *= il; ty0 *= il; tz0 *= il;
  const wx = ty0 * sz - tz0 * sy2, wy = tz0 * sx - tx0 * sz, wz = tx0 * sy2 - ty0 * sx;
  mBasis(MT2, tx0, ty0, tz0, sx, sy2, sz, wx, wy, wz, 0, pY, pZ); mMul(pTorso.mat, RB, MT2);
  // helmet stays level while the bike pitches under it
  mRot(MT2, 1, 0, 0, crashed ? 0.3 : clamp(B.pitch * 0.5, -0.5, 0.5) + 0.06, 0, 0, 0, sx * 0.575 + wx * 0.02, pY + sy2 * 0.575 + wy * 0.02, pZ + sz * 0.575 + wz * 0.02); mMul(pHelmet.mat, RB, MT2);
  for (let sd = -1; sd <= 1; sd += 2) {
    const L = sd < 0, shx = tx0 * 0.2 * sd + sx * 0.425, shy = pY + ty0 * 0.2 * sd + sy2 * 0.425, shz = pZ + tz0 * 0.2 * sd + sz * 0.425;
    const fl = crashed ? min(1, hypot(RD.vx, RD.vy, RD.vz) / 8) : 0; // arms and legs fly about while he is still moving
    let hx = shx + sd * (0.1 + 0.25 * fl * sin(RD.a * 1.7 + sd)), hy = shy + 0.28, hz = shz + 0.3 + 0.3 * fl * cos(RD.a * 1.3 + sd * 2);
    if (!crashed) { const gx = sd * GRIP[0]; hx = MT[0] * gx + MT[4] * GRIP[1] + MT[8] * GRIP[2] + MT[12]; hy = MT[1] * gx + MT[5] * GRIP[1] + MT[9] * GRIP[2] + MT[13]; hz = MT[2] * gx + MT[6] * GRIP[1] + MT[10] * GRIP[2] + MT[14]; }
    // elbows up and out
    ik(shx, shy, shz, hx, hy, hz, 0.27, 0.3, sd * 0.85, 0.4, -0.3);
    seg(L ? pUarmL : pUarmR, RB, shx, shy, shz, JT[0], JT[1], JT[2]); seg(L ? pArmL : pArmR, RB, JT[0], JT[1], JT[2], hx, hy, hz);
    const hpx = tx0 * 0.115 * sd, hpy = pY + ty0 * 0.115 * sd, hpz = pZ + tz0 * 0.115 * sd;
    let ax = sd * 0.205, ay = -0.2, az = -0.09;
    if (B.sm > 0 && !crashed) { ax = mix(ax, sd * 0.16, B.sm); ay = mix(ay, pY + 0.28, B.sm); az = mix(az, pZ - 0.83, B.sm); }
    if (crashed) { ax = hpx + sd * 0.06; ay = hpy - 0.82 + 0.22 * fl * (1 + sin(RD.a * 1.9 + sd)); az = hpz + 0.08 + 0.2 * fl * sin(RD.a * 1.1 + sd * 2); }
    // knees forward, gripping the bike
    ik(hpx, hpy, hpz, ax, ay, az, 0.47, 0.42, sd * 0.28, 0.35, 1);
    seg(L ? pThighL : pThighR, RB, hpx, hpy, hpz, JT[0], JT[1], JT[2]); seg(L ? pShinL : pShinR, RB, JT[0], JT[1], JT[2], ax, ay, az);
  }
  mRot(MT, FAX[0], FAX[1], FAX[2], B.steer, HEAD[0], HEAD[1], HEAD[2], 0, SLIDE[1] * B.cF, SLIDE[2] * B.cF); mMul(pForkL.mat, MB, MT);
  mRot(MT2, 1, 0, 0, B.spinF, 0, 0, 0, AXF[0], AXF[1], AXF[2]); mMul(MT3, MT, MT2); mMul(pWheelF.mat, MB, MT3);
  mRot(MT2, 1, 0, 0, B.spinR, 0, 0, 0, 0, -BK.L + B.cR, -BK.b); mMul(pWheelR.mat, MB, MT2);
  // kit not yet earned is not on the bike
  if (!has(1)) for (const W of WINGS) for (const p of W) p.mat.fill(0);
  if (!has(2)) pRudder.mat.fill(0);
  if (!has(3)) for (let k = 26; k < 30; k++) PARTS[k].mat.fill(0);
  for (const p of PARTS) device.queue.writeBuffer(p.ub, 0, p.mat);
  // ---- landmarks: draw the nearest copy; find them, buzz them, do not hit them
  for (let i = 0; i < LM.length; i++) {
    const l = LM[i]; l.wx = l.x + round((B.x - l.x) / TILE) * TILE; l.wz = l.z + round((B.z - l.z) / TILE) * TILE;
    mRot(l.mat, 0, 1, 0, l.yaw, 0, 0, 0, l.wx, l.y, l.wz); device.queue.writeBuffer(l.ub, 0, l.mat);
    if (!playing || B.crash > 0) continue;
    const dx = B.x - l.wx, dz = B.z - l.wz, dy = B.y - l.y, c = cos(l.yaw), s = sin(l.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c, d = hypot(dx, dy - l.cy, dz);
    const bit = 1 << i, seen = DAILY ? runFound & bit : SAVE.found & bit;
    if (!seen && hypot(dx, dz) < 70) { if (DAILY) { runFound |= bit; score += 1000; big('FOUND ' + l.name + '  +1000'); } else { SAVE.found |= bit; earn(15); big('FOUND ' + l.name + '  +15 s of air'); } }
    if (B.air === 0) l.buzz = 0;
    else if (!l.buzz && B.air > 0.5 && d < l.R) { l.buzz = 1; const pts = l.ring ? 500 : 300; prox += pts; big((l.ring ? 'THREADED ' : 'BUZZED ') + l.name + '  +' + pts); }
    let hit = l.ring && dy > -1 && hypot(hypot(lx, dy + 1) - 20, lz) < 2.6;
    for (const q of l.cols) if (hypot(lx - q[0], lz - q[1]) < q[2] && dy > q[3] && dy < q[4]) hit = true;
    if (hit && B.speed > 4) B.hard = 1;
  }

  // ---- tracks
  track(0, B.x - fX * BK.b - uX * 0.6, B.z - fZ * BK.b - uZ * 0.6, B.gR > 0 && B.crash <= 0, 0.14, 1);
  track(1, B.x + fX * BK.a - uX * 0.6, B.z + fZ * BK.a - uZ * 0.6, B.gF > 0 && B.crash <= 0, 0.085, 0.45);
  // ---- dust from the wheels
  if (playing && B.crash <= 0) {
    const wx = B.x - fX * BK.b - uX * 0.6, wy = B.y - fY * BK.b - uY * 0.6, wz = B.z - fZ * BK.b - uZ * 0.6;
    if (B.gR > 0) {
      dAcc += clamp(B.slip * 140 + abs(B.vlong) * 2.6, 0, 150) * dt;
      while (dAcc >= 1) {
        dAcc -= 1; const k = 1.2 + B.slip * 7 + rnd() * 2.5, sd = (rnd() - 0.5) * 2.4;
        puff(wx, wy, wz, B.vx * 0.3 - sy * k + rX * sd, 0.8 + rnd() * 1.8 + B.slip * 3, B.vz * 0.3 - cy * k + rZ * sd, 1.2 + rnd() * 1.6, 0.2 + rnd() * 0.16, 0.25, 5.5, 0.36);
      }
      // (see below for the rockets' own blast)
  // roost: sand thrown up and back off the paddles, heavier under power and wheelspin
      rAcc += clamp((B.slip * 280 + B.thr * abs(B.vlong) * 3.5) * (1 + 1.5 * B.soft), 0, 380) * dt; // soft sand throws more
      while (rAcc >= 1) {
        rAcc -= 1; const k = 2.5 + B.slip * 7 + rnd() * 4, sd = (rnd() - 0.5) * 2;
        puff(wx + rX * sd * 0.04, wy + 0.06, wz + rZ * sd * 0.04, B.vx * 0.55 - sy * k + rX * sd, 2.5 + rnd() * 4 + B.slip * 4.5, B.vz * 0.55 - cy * k + rZ * sd, 0.55 + rnd() * 0.6, 0.045 + rnd() * 0.06, -9.8, 0.7, 0.8, 0.35);
      }
    }
    if (B.land > 0) {
      soundThump(B.land);
      // the view drops with the hit and shakes; a hard landing throws a skirt of heavy sand as well as dust
      camDropV -= B.land * 2.6; shk = min(1.3, shk + B.land);
      for (let i = 0; i < 46 * max(B.land - 0.3, 0); i++) { const a = rnd() * TAU, k = 3 + rnd() * 5; puff(B.x + sin(a) * 0.4, B.y - 0.6, B.z + cos(a) * 0.4, B.vx * 0.5 + sin(a) * k, 2 + rnd() * 4 * B.land, B.vz * 0.5 + cos(a) * k, 0.6 + rnd() * 0.6, 0.05 + rnd() * 0.07, -9.8, 0.7, 0.8, 0.35); }
      for (let i = 0; i < 26 * B.land + 8; i++) { const a = rnd() * TAU, k = 2 + rnd() * 4; puff(B.x + sin(a) * 0.5, B.y - 0.55, B.z + cos(a) * 0.5, B.vx * 0.4 + sin(a) * k, 0.5 + rnd() * 2, B.vz * 0.4 + cos(a) * k, 1.4 + rnd() * 1.2, 0.25 + rnd() * 0.2); }
      B.land = 0;
    }
  } else B.land = 0;
  // ---- a crash in progress: every hard hit thumps and throws sand, and both bodies trail dust while they slide
  if (B.crash > 0) {
    if (RD.hit > 0) { soundThump(RD.hit); shk = min(1.3, shk + RD.hit * 0.6); for (let i = 0; i < 30 * RD.hit; i++) { const a = rnd() * TAU, k = 1.5 + rnd() * 4; puff(RD.x + sin(a) * 0.3, RD.y, RD.z + cos(a) * 0.3, RD.vx * 0.4 + sin(a) * k, 0.8 + rnd() * 2.5, RD.vz * 0.4 + cos(a) * k, 1.2 + rnd() * 1.2, 0.22 + rnd() * 0.2); } RD.hit = 0; }
    cdAcc += (hypot(RD.vx, RD.vz) + B.speed) * 1.6 * dt;
    while (cdAcc >= 1) { cdAcc -= 1; const o = rnd() < 0.5 ? RD : B; if (o.y - heightAt(o.x, o.z) < 0.6) puff(o.x + rr(-0.3, 0.3), o.y - 0.1, o.z + rr(-0.3, 0.3), o.vx * 0.3, 0.6 + rnd() * 1.4, o.vz * 0.3, 1.1 + rnd(), 0.2 + rnd() * 0.15); }
  }
  // ---- dust devils: each thermal near enough to see lifts a turning column of dust off the sand, so rising air can be read from a distance
  {
    const day = sstep(0.05, 0.5, SUN[1]), ci = floor(B.x / THC), cj = floor(B.z / THC);
    if (day > 0) for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      const k = ((i & 7) + (j & 7) * THN) * 4, S = THERM[k + 3]; if (!S) continue;
      const tx = THERM[k] + (i - (i & 7)) * THC, tz = THERM[k + 1] + (j - (j & 7)) * THC; if (hypot(tx - B.x, tz - B.z) > 620) continue;
      devAcc += 9 * day * dt;
      while (devAcc >= 1) {
        devAcc -= 1; const a = rnd() * TAU, hh = rnd() * rnd() * 110, r = 2.5 + hh * 0.1 + rnd() * 3, px = tx + hh * 0.12 + cos(a) * r, pz = tz + sin(a) * r;
        puff(px, heightAt(tx, tz) + 0.5 + hh, pz, -sin(a) * 7, S * 0.9, cos(a) * 7, 3 + rnd() * 2, 1.2 + hh * 0.02 + rnd(), 1.2, 1.6, 0.2, 0.25);
      }
    }
  }
  // rocket blast: hot exhaust streaming back, and sand torn off the ground when it is close below
  if (B.bst > 0.05 && B.crash <= 0) {
    for (let i = 0; i < 3; i++) {
      const sd = i & 1 ? -1 : 1, k = 9 + rnd() * 8;
      const nx = MB[0] * sd * NOZ[0] + MB[4] * NOZ[1] + MB[8] * (NOZ[2] - 0.6) + MB[12], ny = MB[1] * sd * NOZ[0] + MB[5] * NOZ[1] + MB[9] * (NOZ[2] - 0.6) + MB[13], nz = MB[2] * sd * NOZ[0] + MB[6] * NOZ[1] + MB[10] * (NOZ[2] - 0.6) + MB[14];
      if (rnd() < B.bst) puff(nx, ny, nz, B.vx - fX * k + rr(-1.5, 1.5), B.vy - fY * k + rr(-0.5, 2), B.vz - fZ * k + rr(-1.5, 1.5), 0.7 + rnd() * 0.9, 0.14 + rnd() * 0.1, 0.6, 7, 0.3, 1.2);
    }
  }
  // wind lifting sand off nearby crests: look for a gentle climb behind and a drop ahead, and send a streamer downwind
  for (let i = 0; i < 4; i++) {
    const x = B.x + rr(-80, 80), z = B.z + rr(-80, 80), h = heightAt(x, z);
    if (heightAt(x - 3, z) < h - 0.1 && heightAt(x + 4, z) < h - 0.6) puff(x, h + 0.12, z, 4.5 + rnd() * 3.5, 0.25 + rnd() * 0.5, rr(-0.6, 0.6), 1.5 + rnd() * 1.2, 0.45 + rnd() * 0.4, -0.5, 2.4, 0.17, 0.45);
  }
  dustStep(dt);
  if (dCount) device.queue.writeBuffer(dustVB, 0, dI, 0, dCount * 8);

  // rough air comes through the bars
  if (B.turb > 0.5 && B.wing > 0.3 && B.air > 0.3) shk = max(shk, min(0.5, (B.turb - 0.5) * 0.3));
  // ---- the hit of a landing: the view sinks on a heavy spring and comes back slowly
  { const h = min(dt, 0.033); camDropV += (-camDrop * 70 - camDropV * 11) * h; camDrop += camDropV * h; shk *= exp(-dt * 5.5); }
  // ---- chase camera
  const cr = B.crash > 0, tgX = cr ? RD.x : B.x, tgY = cr ? RD.y : B.y, tgZ = cr ? RD.z : B.z; // a crash is watched from behind the rider, wherever he ends up
  if (playing) { let d = (cr ? RD.yaw : B.yaw + B.r * 0.12) - CAM.yaw; d -= round(d / TAU) * TAU; CAM.yaw += d * (1 - exp(-dt * 3.2)); } else CAM.yaw += dt * 0.12;
  const cd = (playing ? 4.6 : 6.5) + B.speed * 0.03 + B.wing * 2.2, ch = 1.55 + B.speed * 0.012, cyS = sin(CAM.yaw), cyC = cos(CAM.yaw);
  const kx = 1 - exp(-dt * 9), ky = 1 - exp(-dt * 4.5);
  CAM.x += (tgX - cyS * cd - CAM.x) * kx; CAM.z += (tgZ - cyC * cd - CAM.z) * kx; CAM.y += (tgY + ch - CAM.y) * ky;
  const floorY = heightAt(CAM.x, CAM.z) + 0.7; if (CAM.y < floorY) CAM.y = floorY;
  // the rider's eyes when riding; the chase camera for the menu, crashes and chase view
  const fp = pov && playing && B.crash <= 0;
  let ex = CAM.x, ey = CAM.y + camDrop * 1.6, ez = CAM.z, vx, vy, vz, roll = 0, l, inv = 1;
  if (fp) {
    const e1 = EYE[1] + 0.09 * rStand - 0.08 * rCrouch, e2 = EYE[2] + 0.06 * rStand - 0.07 * rBack; // the view rises and shifts with the rider
    ex = MB[0] * EYE[0] + MB[4] * e1 + MB[8] * e2 + MB[12]; ey = MB[1] * EYE[0] + MB[5] * e1 + MB[9] * e2 + MB[13] + camDrop * 0.55; ez = MB[2] * EYE[0] + MB[6] * e1 + MB[10] * e2 + MB[14];
    // the head stays more level than the bike, rolls with part of the lean and looks into the turn
    // Past about eighty degrees (a loop, a flip) the head goes with the bike all the way round instead.
    camLp += clamp((B.air > 0 && abs(B.pitch) > 1.35 ? 1 : 0) - camLp, -dt * 5, dt * 5);
    const pf = 0.55 + 0.45 * camLp, dpw = B.pitch - pPrev; if (abs(dpw) > PI) camPitch += (dpw > 0 ? 1 : -1) * TAU * pf;
    camPitch += (B.pitch * pf - 0.26 * (1 - camLp) - camPitch) * (1 - exp(-dt * 7)); camRoll += ((ln - B.roll) * 0.62 - camRoll) * (1 - exp(-dt * 9));
    const yw = B.yaw + clamp(B.r * 0.1, -0.25, 0.25) + B.steer * 0.25, cpp = camPitch + camDrop * 0.45 + shk * 0.014 * sin(tNow * 67), cq = cos(cpp);
    vx = sin(yw) * cq; vy = sin(cpp); vz = cos(yw) * cq; roll = camRoll + B.roll + shk * 0.02 * sin(tNow * 53); if (cq < 0) inv = -1;
  } else {
    const ld = cr ? 0 : 2.5; vx = tgX + cyS * ld - CAM.x; vy = tgY + 0.55 - CAM.y; vz = tgZ + cyC * ld - CAM.z; l = 1 / hypot(vx, vy, vz); vx *= l; vy *= l; vz *= l;
    camPitch = B.pitch * 0.55 - 0.26; camRoll = 0; camLp = 0;
  }
  pPrev = B.pitch;
  l = 1 / hypot(vx, vz); const fhx = vx * l, fhz = vz * l, r0x = vz * l * inv, r0z = -vx * l * inv, u0x = vy * r0z, u0y = vz * r0x - vx * r0z, u0z = -vy * r0x;
  const cro = cos(roll), sro = sin(roll), cRx = r0x * cro - u0x * sro, cRy = -u0y * sro, cRz = r0z * cro - u0z * sro, cUx = u0x * cro + r0x * sro, cUy = u0y * cro, cUz = u0z * cro + r0z * sro;
  const fov = dbgFov || (fp ? 1.45 : 0.98) + min(B.speed, 40) * 0.0075 + B.bst * 0.1 + shk * 0.05, ty = tan(fov / 2), tx = ty * RW / RH, sX = 1 / tx, sY = 1 / ty, NEAR = fp ? 0.06 : 0.15;
  const cdR = ex * cRx + ey * cRy + ez * cRz, cdU = ex * cUx + ey * cUy + ez * cUz, cdF = ex * vx + ey * vy + ez * vz;
  U[0] = sX * cRx; U[4] = sX * cRy; U[8] = sX * cRz; U[12] = -sX * cdR;
  U[1] = sY * cUx; U[5] = sY * cUy; U[9] = sY * cUz; U[13] = -sY * cdU;
  U[2] = 0; U[6] = 0; U[10] = 0; U[14] = NEAR;
  U[3] = vx; U[7] = vy; U[11] = vz; U[15] = -cdF;
  // ---- shadow map around the bike
  const E = 3.4, R = 90, S = SUN, shl = hypot(S[0], S[2]); l = shl > 1e-3 ? 1 / shl : 0;
  const lRx = l ? S[2] * l : 1, lRz = -S[0] * l, lUx = S[1] * lRz, lUy = S[2] * lRx - S[0] * lRz, lUz = -S[1] * lRx;
  U[16] = lRx / E; U[20] = 0; U[24] = lRz / E; U[28] = -(B.x * lRx + B.z * lRz) / E;
  U[17] = lUx / E; U[21] = lUy / E; U[25] = lUz / E; U[29] = -(B.x * lUx + B.y * lUy + B.z * lUz) / E;
  U[18] = -S[0] / (2 * R); U[22] = -S[1] / (2 * R); U[26] = -S[2] / (2 * R); U[30] = (B.x * S[0] + B.y * S[1] + B.z * S[2]) / (2 * R) + 0.5;
  U[19] = 0; U[23] = 0; U[27] = 0; U[31] = 1;
  bikeSh += (shadowAt(B.x, B.z) - bikeSh) * min(1, dt * 8);
  U[32] = ex; U[33] = ey; U[34] = ez; U[35] = tNow;
  U[36] = cRx * tx; U[37] = cRy * tx; U[38] = cRz * tx; U[39] = expo;
  U[40] = cUx * ty; U[41] = cUy * ty; U[42] = cUz * ty;
  U[44] = vx; U[45] = vy; U[46] = vz; U[47] = NEAR;
  U[48] = S[0]; U[49] = S[1]; U[50] = S[2]; U[51] = night;
  U[52] = SUNC[0]; U[53] = SUNC[1]; U[54] = SUNC[2]; U[55] = SUN_TAN;
  U[56] = AMB[0]; U[57] = AMB[1]; U[58] = AMB[2]; U[59] = SUN_SIDE;
  U[68] = fX; U[69] = fY; U[70] = fZ; U[71] = night * 3;
  const g0x = B.x - fX * BK.b - uX * 0.6, g0z = B.z - fZ * BK.b - uZ * 0.6, g1x = B.x + fX * BK.a - uX * 0.6, g1z = B.z + fZ * BK.a - uZ * 0.6, up = B.crash <= 0 ? 1 : 0;
  U[72] = g0x; U[73] = heightAt(g0x, g0z); U[74] = g0z; U[75] = B.gR > 0 ? up : 0;
  U[76] = g1x; U[77] = heightAt(g1x, g1z); U[78] = g1z; U[79] = B.gF > 0 ? up : 0;
  U[60] = B.x; U[61] = B.y; U[62] = B.z; U[63] = bikeSh;
  U[64] = SAND[0]; U[65] = SAND[1]; U[66] = SAND[2];
  device.queue.writeBuffer(UB, 0, U);
  selectNodes(ex, ez, fhx, fhz);
  device.queue.writeBuffer(nodeVB, 0, NODES, 0, nNodes * 4);

  // ---- draw
  const enc = device.createCommandEncoder();
  let rp;
  if (skyDirty) {
    skyDirty = false;
    rp = enc.beginRenderPass({ colorAttachments: [{ view: viewSky, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] });
    rp.setPipeline(pSkyBake); rp.setBindGroup(0, bgS); rp.draw(3); rp.end();
  }
  rp = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: viewSM, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  rp.setPipeline(pShadow); rp.setBindGroup(0, bgS);
  for (const p of PARTS) { if (p.fx) continue; rp.setBindGroup(1, p.bg); rp.setVertexBuffer(0, p.vb); rp.setIndexBuffer(p.ib, 'uint32'); rp.drawIndexed(p.n); }
  for (const p of LM) { rp.setBindGroup(1, p.bg); rp.setVertexBuffer(0, p.vb); rp.setIndexBuffer(p.ib, 'uint32'); rp.drawIndexed(p.n); }
  rp.end();
  rp = enc.beginRenderPass(passScene);
  rp.setBindGroup(0, bgM);
  rp.setPipeline(pTerrain); rp.setVertexBuffer(0, gridVB); rp.setVertexBuffer(1, nodeVB); rp.setIndexBuffer(gridIB, 'uint16'); rp.drawIndexed(gridN, nNodes);
  if (kUsed) { rp.setPipeline(pTrack); rp.setVertexBuffer(0, trackVB); rp.draw(6, kUsed); }
  rp.setPipeline(pPShadow);
  rp.setVertexBuffer(0, PROPS[0].inst); rp.draw(48, PROPS[0].count); rp.setVertexBuffer(0, tuftVB); rp.draw(48, tuftN);
  rp.setPipeline(pProp);
  for (const p of PROPS) { rp.setVertexBuffer(0, p.vb); rp.setVertexBuffer(1, p.inst); rp.setIndexBuffer(p.ib, 'uint32'); rp.drawIndexed(p.n, p.count); }
  rp.setPipeline(pGrass); rp.setVertexBuffer(0, bladeVB); rp.draw(18, bladeN);
  rp.setPipeline(pBike);
  for (const p of PARTS) { if ((fp && p.hide) || (p.fx && B.bst < 0.03)) continue; rp.setBindGroup(1, p.bg); rp.setVertexBuffer(0, p.vb); rp.setIndexBuffer(p.ib, 'uint32'); rp.drawIndexed(p.n); }
  for (const p of LM) { rp.setBindGroup(1, p.bg); rp.setVertexBuffer(0, p.vb); rp.setIndexBuffer(p.ib, 'uint32'); rp.drawIndexed(p.n); }
  rp.setPipeline(pSky); rp.draw(3);
  if (dCount) { rp.setPipeline(pDust); rp.setVertexBuffer(0, dustVB); rp.draw(6, dCount); }
  rp.setPipeline(pMote); rp.setVertexBuffer(0, moteVB); rp.draw(6, MOTES);
  rp.end();
  // light shafts at half resolution, then their blur
  rp = enc.beginRenderPass(passRays); rp.setPipeline(pRays); rp.setBindGroup(0, bgM); rp.setBindGroup(1, bgDepth); rp.draw(3); rp.end();
  rp = enc.beginRenderPass(passBlur); rp.setPipeline(pRB); rp.setBindGroup(0, bgBlur); rp.draw(3); rp.end();
  // bloom
  for (let i = 0; i < bloomPass.length; i++) { rp = enc.beginRenderPass(bloomPass[i]); rp.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); rp.setBindGroup(0, bloomBG[i]); rp.draw(3); rp.end(); }
  // composite to the screen
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  rp = enc.beginRenderPass(passPost); rp.setPipeline(pPost); rp.setBindGroup(0, bgPost); rp.draw(3); rp.end();
  device.queue.submit([enc.finish()]);

  // ---- HUD
  // air time: counts up live, is banked as score on a clean landing (100 points a second), and is lost in a crash
  // proximity: gliding fast with the sand close under or beside the wings builds points, more the closer it is;
  // like air time they are banked by a clean landing and lost in a crash
  proxD = -1;
  if (B.air > 1.2 && B.wing > 0.5 && B.crash <= 0 && B.speed > 14) { groundNormal(B.x, B.z); const d = max(0, (B.y - heightAt(B.x, B.z) - 0.7) * _gn[1]); if (d < 12) { proxD = d; prox += (1 - d / 12) * (1 - d / 12) * B.speed * 9 * dt; } }
  // tricks: each is called as it is done and added to a pot that a landing banks and a crash loses, like the air time
  if (B.rolls > nRoll) { trick += 300; big('BARREL ROLL  +300'); } nRoll = B.rolls;
  if (B.loops > nLoop) { trick += 600; big('LOOP  +600'); } nLoop = B.loops;
  if (B.spins > nSpin) { trick += 400; big('360  +400'); } nSpin = B.spins;
  if (B.sm > 0.8 && B.crash <= 0) smT += dt; else if (smT > 0 && B.sm < 0.2) { if (B.crash <= 0 && smT > 0.3) { const p = round(smT * 250); trick += p; big('SUPERMAN ' + smT.toFixed(1) + ' s  +' + p); } smT = 0; }
  if (B.crash > 0) { trick = 0; wasBones = RD.bones; if (airMax > 0.5) { airText = '   lost ' + airMax.toFixed(1) + ' s'; airShow = 2.5; } airMax = 0; B.flips = 0; prox = 0; }
  else if (wasBones) { bones += wasBones; keep('duneBones', '' + bones); airText = '   ' + wasBones + (wasBones > 1 ? ' bones broken' : ' bone broken') + ', thrown ' + round(RD.dist) + ' m'; airShow = 3.5; wasBones = 0; }
  else if (B.air > 0) airMax = B.air;
  else if (airMax > 0) {
    if (airMax > 0.5) { const nf = abs(B.flips), pp = round(prox), lq = B.lq, pts = round((round(airMax * 100) + 500 * nf + pp + trick) * (lq === 3 ? 1.5 : 1)); score += pts; earn(airMax + (lq === 3 ? 1 : 0)); if (lq === 3) big('PERFECT LANDING  x1.5  +1 s of air'); airText = '   +' + pts + '   air +' + airMax.toFixed(1) + ' s' + (lq === 3 ? '   perfect landing' : lq === 2 ? '   clean landing' : lq === 1 ? '   heavy landing' + (abs(B.lrel) > 0.16 ? (B.lrel > 0 ? ', nose high' : ', nose low') : '') : '') + (pp ? '   proximity ' + pp : '') + (trick ? '   tricks ' + trick : '') + (nf ? '   ' + (nf > 1 ? nf + ' x ' : '') + (B.flips > 0 ? 'backflip' : 'front flip') : ''); airShow = 3; if (airMax > bestAir) { bestAir = airMax; keep('duneBestAir', bestAir.toFixed(2)); } }
    airMax = 0; B.flips = 0; prox = 0; trick = 0;
  }
  elFuel.style.transform = 'scaleX(' + B.fuel.toFixed(3) + ')';
  // the daily run's clock; when it runs out the score stands and the best for the day is kept
  if (DAILY && playing && !runDone) { runT -= dt; if (runT <= 0) { runT = 0; runDone = true; if (SAVE.daily !== DAY || score > SAVE.best) { SAVE.daily = DAY; SAVE.best = score; } saveNow(); pause(); } }
  airShow -= dt; hudT -= dt; noteT -= dt; bigT -= dt;
  if (hudT <= 0) {
    hudT = 0.1; const hh = floor(hour), mm = floor((hour - hh) * 60);
    // which way to the nearest landmark not yet found (or the nearest of all once they are)
    let lmTxt = '';
    { let bd = 1e9, bl = null; const todo = LM.some((l, i) => !((DAILY ? runFound : SAVE.found) & 1 << i)); LM.forEach((l, i) => { if (todo && (DAILY ? runFound : SAVE.found) & 1 << i) return; const d = hypot(l.wx - B.x, l.wz - B.z); if (d < bd) { bd = d; bl = l; } });
      if (bl) { let a = Math.atan2(bl.wx - B.x, bl.wz - B.z) - B.yaw; a -= round(a / TAU) * TAU; lmTxt = '\n' + (todo ? '? ' : '') + bl.name + ' ' + round(bd) + ' m ' + '\u2191\u2197\u2192\u2198\u2193\u2199\u2190\u2196'[(round(a / (PI / 4)) + 8) % 8]; } }
    // landing aid: coming down without wings, where the bike will touch and how its nose sits against that slope
    let landTxt = '';
    if (B.air > 0.6 && B.vy < -1 && B.wing < 0.2 && B.crash <= 0) {
      const hg = B.y - heightAt(B.x, B.z);
      if (hg < 30) {
        const tt = min(2, hg / max(-B.vy, 1)), px = B.x + B.vx * tt, pz = B.z + B.vz * tt, hv = hypot(B.vx, B.vz) || 1, ux = B.vx / hv, uz = B.vz / hv;
        const sl = Math.atan2(heightAt(px + ux * 2, pz + uz * 2) - heightAt(px - ux * 2, pz - uz * 2), 4), d = round((B.pitch - sl) * 57.3);
        landTxt = '\nLANDING  slope ' + round(sl * 57.3) + ' deg   ' + (abs(d) <= 9 ? 'LINED UP' : d > 0 ? 'nose ' + d + ' deg high (I)' : 'nose ' + -d + ' deg low (K)');
      }
    }
    elScore.textContent = playing ? (DAILY ? 'DAILY ' + floor(runT / 60) + ':' + ('0' + floor(runT % 60)).slice(-2) + '    ' : '') + 'SCORE ' + score + '    AIR BANK ' + SAVE.bank.toFixed(0) + ' s    BEST AIR ' + bestAir.toFixed(1) + ' s' + (bones ? '    BONES ' + bones : '') + lmTxt + (bigT > 0 ? '\n' + bigText : '') + (airMax > 0.4 ? '\nAIR ' + airMax.toFixed(1) + ' s' + (abs(B.rot) > 5 ? '   FLIP ' + floor(abs(B.rot) / TAU + 0.2) : '') + (trick ? '   TRICKS ' + trick : '') + (B.sm > 0.8 ? '   SUPERMAN: let go before you land' : '') : '') + (B.wing > 0.3 && B.air > 0.5 ? '\nCLIMB ' + (B.vy >= 0 ? '+' : '') + B.vy.toFixed(1) + ' m/s' + (B.lift > 0.8 ? '   LIFT +' + B.lift.toFixed(1) : B.lift < -0.8 ? '   SINK ' + B.lift.toFixed(1) : '') : '') + landTxt + (B.bury > 0.25 ? '\nBURIED: throttle to dig out' : B.soft > 0.5 && B.air === 0 ? '\nSOFT SAND' : '') + (B.ab > 0.5 ? '\nAIR BRAKE' : '') + (B.tk > 0.5 && B.air > 0 ? '\nSTOOP ' + round(B.speed * 3.6) + ' km/h' + (B.y - heightAt(B.x, B.z) < B.speed * B.speed / 45 ? '   PULL OUT NOW: let go of F' : B.sb > 0.6 ? '   charged: let go of F to zoom' : '') : B.sb > 0.1 && B.wing > 0.5 ? '\nZOOM' + (B.vy > 1 ? ' +' + round(B.vy) + ' m/s' : ': pull up (S)') : '') + (B.hi > 0.15 && B.wing > 0.3 ? '\nROUGH AIR' + (B.hi > 0.6 ? ': too high, the wings will let go' : '') : '') + (B.stl ? '\nSTALL: nose down' : '') + (B.fold > 0.3 ? '\nWING TIPS FOLDED: slow down' : '') + (B.ps > 0.5 ? '\nPOWER SLIDE' : '') + (prox >= 1 ? '\nPROXIMITY +' + round(prox) + (proxD >= 0 ? '   ' + proxD.toFixed(1) + ' m' : '') : '') : '';
    elFuelBox.className = B.bst > 0.5 ? 'x' : B.armed ? '' : 'z';
    elHud.textContent = playing ? round(B.speed * 3.6) + ' km/h   ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + (B.crash > 0 ? '   crashed   ' + RD.bones + (RD.bones > 1 ? ' bones' : ' bone') : noteT > 0 ? note : airShow > 0 ? airText : '') : '';
  }
}
await tick(1, 'Ready');
// draw the first frame and wait for the GPU to finish it (pipelines compile on first use) before the reveal
frame(performance.now());
await device.queue.onSubmittedWorkDone();
try { delete localStorage.duneLoad; } catch {}
body.className = 'm';
// detail button: shows the level, steps to the next and reloads
const elQ = $('q'); elQ.textContent = 'Detail: ' + ['High', 'Medium', 'Low'][LV]; elQ.onclick = () => { keep('dune', (LV + 1) % 3); location.reload(); };
// A fixed 30-second ride for measuring frame times: same start, same inputs, same hour, every run.
// DUNE.bench() resolves to { avg, p99, max, over } in milliseconds; "over" counts frames longer than 17.5 ms.
async function bench() {
  resetBike(spX, spZ, PI / 2); hour = 16.5; tRate = 2; pov = true; playing = true; body.className = 'g'; benchT = 0; benchF.length = 0; benching = true;
  await new Promise((r) => { benchDone = r; });
  benching = false; IN.boost = 0; B.wingOn = 0; benchF.shift(); benchF.sort((a, b) => a - b);
  const r = { frames: benchF.length, avg: +(benchF.reduce((a, b) => a + b, 0) / benchF.length).toFixed(2), p99: +benchF[floor(benchF.length * 0.99)].toFixed(1), max: +benchF[benchF.length - 1].toFixed(1), over: benchF.filter((x) => x > 17.5).length, res: [RW, RH], level: LV };
  say('avg ' + r.avg + ' ms, worst ' + r.max + ' ms'); return r;
}
// for debugging from the console
window.DUNE = { LM, SAVE, bench, get score() { return score; }, rmk: RMK, wings(v) { B.wingOn = v ? 1 : 0; }, tufts: propData.tufts, counts: { rocks: PROPS[0].count, pebbles: PROPS[1].count, tufts: tuftN, blades: bladeN }, set fov(v) { dbgFov = v; }, rocks: propData.rocks, reset: resetBike, get res() { return [RW, RH]; }, loadMs: round(performance.now()), B, IN, CAM, frame, get playing() { return playing; }, set playing(v) { playing = v; }, get hour() { return hour; }, set hour(v) { hour = v; }, get pov() { return pov; }, set pov(v) { pov = v; }, set rate(v) { tRate = v; } };
