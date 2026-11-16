// ============================================================================
// sound, synthesized live: a single-cylinder engine that follows the revs, and wind that follows the speed
// ============================================================================
let AC = null, aOsc1, aOsc2, aOsc3, aFilt, aEng, aWind, aWindF, aHiss, aRocket, aMaster, aNoise, muted = false, rpm = 1800, lastGear = 0, shiftT = 0;
const GEARS = [9, 15, 22, 30, 42]; // top speed of each gear, m/s

function sound() {
  if (AC) { AC.resume(); return; }
  const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
  AC = new A();
  aMaster = AC.createGain(); aMaster.gain.value = 0.5; aMaster.connect(AC.destination);
  // engine: three detuned oscillators through a waveshaper and a low-pass that opens with the throttle
  aFilt = AC.createBiquadFilter(); aFilt.type = 'lowpass'; aFilt.frequency.value = 400; aFilt.Q.value = 2.5;
  const shape = AC.createWaveShaper(), curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 3.2); }
  shape.curve = curve;
  aEng = AC.createGain(); aEng.gain.value = 0;
  const mk = (type, gain) => { const o = AC.createOscillator(), gn = AC.createGain(); o.type = type; gn.gain.value = gain; o.connect(gn); gn.connect(shape); o.start(); return o; };
  aOsc1 = mk('sawtooth', 0.5); aOsc2 = mk('square', 0.3); aOsc3 = mk('sawtooth', 0.25);
  shape.connect(aFilt); aFilt.connect(aEng); aEng.connect(aMaster);
  // wind: looping noise through a band-pass
  const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ns = AC.createBufferSource(); ns.buffer = nb; ns.loop = true;
  aWindF = AC.createBiquadFilter(); aWindF.type = 'bandpass'; aWindF.frequency.value = 500; aWindF.Q.value = 0.6;
  aWind = AC.createGain(); aWind.gain.value = 0;
  ns.connect(aWindF); aWindF.connect(aWind); aWind.connect(aMaster); ns.start();
  // sand hissing under the tyres: the same noise, high-passed
  const hs = AC.createBufferSource(), hf = AC.createBiquadFilter(); hs.buffer = nb; hs.loop = true; hf.type = 'highpass'; hf.frequency.value = 2800;
  aHiss = AC.createGain(); aHiss.gain.value = 0; hs.connect(hf); hf.connect(aHiss); aHiss.connect(aMaster); hs.start(0, 0.7);
  aNoise = nb;
  // rocket: the noise again, low and loud
  const rs = AC.createBufferSource(), rf = AC.createBiquadFilter(); rs.buffer = nb; rs.loop = true; rf.type = 'lowpass'; rf.frequency.value = 700; rf.Q.value = 1.2;
  aRocket = AC.createGain(); aRocket.gain.value = 0; rs.connect(rf); rf.connect(aRocket); aRocket.connect(aMaster); rs.start(0, 1.3);
}

// landing: a low thud from the suspension and a burst of sand
function soundThump(s) {
  if (!AC || muted) return;
  const t = AC.currentTime, o = AC.createOscillator(), gn = AC.createGain();
  const w = min(s, 1.5), len = 0.3 + 0.3 * w;
  o.type = 'sine'; o.frequency.setValueAtTime(78 - 14 * w, t); o.frequency.exponentialRampToValueAtTime(26, t + 0.22 + 0.1 * w);
  gn.gain.setValueAtTime(min(1.2, 0.8 * s), t); gn.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(gn); gn.connect(aMaster); o.start(t); o.stop(t + len + 0.02);
  // the weight of it: a slower, lower note under the thud, and the chassis bottoming out
  const o2 = AC.createOscillator(), g2 = AC.createGain();
  o2.type = 'sine'; o2.frequency.setValueAtTime(46, t); o2.frequency.exponentialRampToValueAtTime(22, t + 0.5);
  g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(min(1.3, 0.9 * w), t + 0.03); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + 0.35 * w);
  o2.connect(g2); g2.connect(aMaster); o2.start(t); o2.stop(t + 0.75 + 0.35 * w);
  if (w > 0.6) {
    const o3 = AC.createOscillator(), g3 = AC.createGain(), f3 = AC.createBiquadFilter(); o3.type = 'square'; o3.frequency.setValueAtTime(150, t); o3.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    f3.type = 'lowpass'; f3.frequency.value = 900; g3.gain.setValueAtTime(0.22 * w, t); g3.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o3.connect(f3); f3.connect(g3); g3.connect(aMaster); o3.start(t); o3.stop(t + 0.1);
  }
  const b = AC.createBufferSource(), bg = AC.createGain(), bf = AC.createBiquadFilter(); b.buffer = aNoise; bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.5;
  bg.gain.setValueAtTime(0.35 * s, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  b.connect(bf); bf.connect(bg); bg.connect(aMaster); b.start(t, Math.random()); b.stop(t + 0.37);
}

// wings: a servo whirr and three latches as the sections lock out (or two as they stow)
function soundWings(out) {
  if (!AC || muted) return;
  const t = AC.currentTime, o = AC.createOscillator(), gn = AC.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(out ? 180 : 420, t); o.frequency.exponentialRampToValueAtTime(out ? 520 : 150, t + 0.5);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.06, t + 0.05); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
  o.connect(gn); gn.connect(aMaster); o.start(t); o.stop(t + 0.55);
  for (const d of out ? [0.2, 0.36, 0.5] : [0.25, 0.48]) {
    const b = AC.createBufferSource(), bg = AC.createGain(), bf = AC.createBiquadFilter(); b.buffer = aNoise; bf.type = 'bandpass'; bf.frequency.value = 2400; bf.Q.value = 4;
    bg.gain.setValueAtTime(0.5, t + d); bg.gain.exponentialRampToValueAtTime(0.001, t + d + 0.07);
    b.connect(bf); bf.connect(bg); bg.connect(aMaster); b.start(t + d, Math.random()); b.stop(t + d + 0.09);
  }
}

// called every frame while riding
function soundUpdate(dt, on) {
  // revs follow the rear wheel through an automatic gearbox; the wheel spinning free in the air lets them rise
  const v = abs(B.wR) * BK.Rr;
  let gear = 0; while (gear < 4 && v > GEARS[gear] * 0.86) gear++;
  const target = B.crash > 0 ? 1500 : 1900 + 7600 * clamp(v / GEARS[gear], 0, 1.05) + B.thr * 500 - B.bog * 1600; // (the engine labours for a moment after a heavy landing)
  // an upshift cuts the drive for a moment and the revs drop into the next gear
  if (gear !== lastGear) { if (gear > lastGear) shiftT = 0.13; lastGear = gear; }
  shiftT -= dt;
  rpm += (target - rpm) * min(1, dt * 9);
  if (!AC) return;
  const t = AC.currentTime, f = rpm / 60;
  aOsc1.frequency.setTargetAtTime(f, t, 0.02); aOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.02); aOsc3.frequency.setTargetAtTime(f * 1.503, t, 0.02);
  aFilt.frequency.setTargetAtTime(260 + rpm * 0.16 + B.thr * 1500, t, 0.04);
  aEng.gain.setTargetAtTime(on && !muted ? (0.10 + B.thr * 0.2) * (shiftT > 0 ? 0.3 : 1) : 0, t, shiftT > 0 ? 0.015 : 0.06);
  aHiss.gain.setTargetAtTime(on && !muted && (B.gR > 0 || B.gF > 0) ? min(0.22, B.slip * 0.2 + B.speed * 0.0035) : 0, t, 0.08);
  aRocket.gain.setTargetAtTime(on && !muted ? B.bst * 0.9 : 0, t, 0.04);
  aWind.gain.setTargetAtTime(on && !muted ? min(0.5, B.speed * B.speed * 0.00045) : 0, t, 0.1);
  aWindF.frequency.setTargetAtTime(350 + B.speed * 22, t, 0.1);
}
