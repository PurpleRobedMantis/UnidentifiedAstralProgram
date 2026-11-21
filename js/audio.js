// All sound is synthesised with the Web Audio API. No audio files.
let ctx = null, master = null, noiseBuf = null, out = null;
// developer-menu mute, remembered in this browser
let muted = false; try { muted = localStorage.getItem('uap-mute') === '1'; } catch (_) {}
// paused: the output is held silent while the context keeps running (see suspend)
let held = false;
const live = new Set(); // drones still sounding, so a scene change can never leave one running
// where a gain ramp is right now, from what was scheduled (never from AudioParam.value, which lags the schedule)
function track(a, b, t0, t1, exp) {
  const L = { a, b, t0, t1, exp };
  L.now = () => { const n = ctx.currentTime; if (n >= L.t1) return L.b; if (n <= L.t0) return L.a; const k = (n - L.t0) / (L.t1 - L.t0); return L.exp ? L.a * Math.pow(L.b / L.a, k) : L.a + (L.b - L.a) * k; };
  L.go = (b2, t1b, exp2) => { const n = ctx.currentTime; L.a = Math.max(L.now(), 0.0001); L.b = Math.max(b2, 0.0001); L.t0 = n; L.t1 = t1b; L.exp = exp2; return L.a; };
  return L;
}

// stretches every A.rise build-up (1 = as written in the scene)
export const RISE_SLOW = 1;
// developer speed-up: sustained sounds (drones, rises, the carrier wave) ramp in game time, so they keep pace with the scene
const sp = (s) => s / (A.speed || 1);
// crowd voices (murmur, whisper, cackle, mock): at most CROWD of them start in any real second. Scenes call them in game
// time, so at a developer speed-up they came several times as fast (jester hall at 8x: about 10x the sound sources a
// real second) until the browser's audio thread fell behind and the sound cut out for most of a minute.
const CROWD = 12, crowdAt = [];
const crowded = () => {
  const now = performance.now();
  while (crowdAt.length && now - crowdAt[0] > 1000) crowdAt.shift();
  if (crowdAt.length >= CROWD) return true;
  crowdAt.push(now); return false;
};
// one incidental cue that starts several sources (a console tick, a loom pluck, a run of clicks): at most max of it in any
// real second, whatever the speed. The crowd limit alone still let the control room start about 50 sources a real second
// at 8x (12 multi-source cues), and the sound broke up as in the jester hall.
const paceAt = {};
const paced = (key, max) => {
  const now = performance.now(), q = paceAt[key] || (paceAt[key] = []);
  while (q.length && now - q[0] > 1000) q.shift();
  if (q.length >= max) return true;
  q.push(now); return false;
};
export const A = {
  speed: 1,
  get muted() { return muted; },
  // silence everything (or bring it back) at the very end of the chain
  setMute(m) {
    muted = !!m; try { localStorage.setItem('uap-mute', muted ? '1' : '0'); } catch (_) {}
    if (out) out.gain.setTargetAtTime(muted || held ? 0 : 1, ctx.currentTime, 0.02);
    try { dispatchEvent(new Event('uap-mute')); } catch (_) {}   // every MUTE button relabels itself
  },
  init() {
    if (ctx) { ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // master -> gentle compressor -> out, plus a small high-passed room reverb so nothing sounds dry and pasted on
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.25;
      out = ctx.createGain(); out.gain.value = muted ? 0 : 1; comp.connect(out); out.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = 0.6; master.connect(comp);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const len = Math.floor(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const b = ir.getChannelData(c); for (let i = 0; i < len; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      const rev = ctx.createConvolver(); rev.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = 0.16;
      master.connect(hp); hp.connect(rev); rev.connect(wet); wet.connect(comp);
    } catch (_) { ctx = null; }
  },
  tone(f, d = 0.3, { type = 'sine', g = 0.2, a = 0.01, to = null } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), v = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(g, t + a); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v).connect(master); o.start(t); o.stop(t + d + 0.05);
  },
  noise(d = 0.3, { g = 0.2, f = 1000, q = 1, type = 'bandpass', to = null } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime, s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; b.type = type; b.frequency.setValueAtTime(f, t); b.Q.value = q;
    if (to) b.frequency.exponentialRampToValueAtTime(to, t + d);
    v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(g, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(b).connect(v).connect(master); s.start(t, Math.random()); s.stop(t + d + 0.05);
  },
  // A sustained voice that scenes can steer. Returns { set(freq, gain, seconds), swell(gain, seconds), stop(seconds) }.
  drone(f, { type = 'sine', g = 0.1, noise = false, q = 2, fade = 2.5 } = {}) {
    if (!ctx) return { set() {}, stop() {}, swell() {} };
    fade = sp(fade);
    const t = ctx.currentTime, v = ctx.createGain();
    v.gain.value = 0.0001; v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(Math.max(g, 0.0001), t + fade);
    const L = track(0.0001, Math.max(g, 0.0001), t, t + fade, true);
    let src, fp;
    if (noise) {
      src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
      src.connect(b).connect(v); fp = b.frequency;
    } else {
      src = ctx.createOscillator(); src.type = type; src.frequency.value = f; src.connect(v); fp = src.frequency;
    }
    v.connect(master); src.start(t);
    src.onended = () => { try { v.disconnect(); } catch (_) {} };
    const h = {
      // bring the level up (or down) at an even rate to the ear: it climbs in decibels (from about 30 dB under the target,
      // just audible, to the target), eased at both ends. An exponential ramp from silence would stay inaudible for most
      // of its length and then arrive all at once, which made tones seem to switch on.
      swell(gain, sec = 6) {
        sec = sp(sec);
        const n = ctx.currentTime, g1 = Math.max(gain, 0.0001), from = L.go(g1, n + sec, true), N = 64, curve = new Float32Array(N);
        const lo = Math.max(Math.min(from, g1), g1 * 0.03), up = g1 >= from;
        for (let i = 0; i < N; i++) { const k = i / (N - 1), e = k * k * (3 - 2 * k); curve[i] = up ? lo * Math.pow(g1 / lo, e) : from * Math.pow(g1 / from, e); }
        curve[0] = Math.max(from, 0.0001);
        try { v.gain.cancelScheduledValues(n); v.gain.setValueCurveAtTime(curve, n, sec); } catch (_) { v.gain.linearRampToValueAtTime(g1, n + sec); }
      },
      set(freq, gain, sec = 0.5) {
        sec = sp(sec);
        const n = ctx.currentTime;
        if (freq) { fp.cancelScheduledValues(n); fp.setValueAtTime(fp.value, n); fp.exponentialRampToValueAtTime(freq, n + sec); }
        if (gain !== undefined) { const from = L.go(gain, n + sec, true); v.gain.cancelScheduledValues(n); v.gain.setValueAtTime(from, n); v.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), n + sec); }
      },
      stop(sec = 0.6) {
        const n = ctx.currentTime;
        const from = L.go(0.0001, n + sec, false); v.gain.cancelScheduledValues(n); v.gain.setValueAtTime(from, n); v.gain.linearRampToValueAtTime(0.0001, n + sec);
        try { src.stop(n + sec + 0.1); } catch (_) {}
        live.delete(h);
      },
    };
    live.add(h);
    return h;
  },
  stopAll(sec = 0.3) { for (const h of [...live]) h.stop(sec); },
  // A dog heard through a wall: a voiced growl-to-woof with two mouth formants, a breath of noise and a street echo.
  bark() {
    if (!ctx) return;
    const t = ctx.currentTime, d = 0.2, f0 = 240 + Math.random() * 60;
    const out = ctx.createGain(); out.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700;
    const echo = ctx.createDelay(0.5); echo.delayTime.value = 0.13; const eg = ctx.createGain(); eg.gain.value = 0.28;
    out.connect(lp); lp.connect(master); lp.connect(echo); echo.connect(eg); eg.connect(master);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 0.018); env.gain.setValueAtTime(1, t + 0.06); env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    env.connect(out);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.75, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.035); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + d);
    for (const [f, q, g] of [[520, 4, 1], [1050, 5, 0.7], [2300, 6, 0.25]]) {
      const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = q;
      b.frequency.setValueAtTime(f * 0.8, t); b.frequency.linearRampToValueAtTime(f * 1.25, t + 0.05); b.frequency.linearRampToValueAtTime(f * 0.85, t + d);
      const bg = ctx.createGain(); bg.gain.value = g; o.connect(b); b.connect(bg); bg.connect(env);
    }
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 900; nb.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.45; n.connect(nb); nb.connect(ng); ng.connect(env);
    o.start(t); o.stop(t + d + 0.05); n.start(t, Math.random()); n.stop(t + d + 0.05);
  },
  // A sly, breathy whisper near one ear: a run of soft sibilant syllables. pan -1 (left) to 1 (right).
  whisper(pan = (Math.random() * 2 - 1) * 0.9, loud = 1) {
    if (!ctx || crowded()) return;
    let t = ctx.currentTime + 0.02;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = pan; p.connect(master);
    const syll = 3 + Math.floor(Math.random() * 6);
    for (let i = 0; i < syll; i++) {
      const d = 0.07 + Math.random() * 0.16, s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain();
      s.buffer = noiseBuf; b.type = 'bandpass'; b.Q.value = 1.5 + Math.random() * 3;
      const f = Math.random() < 0.4 ? 4200 + Math.random() * 2600 : 1200 + Math.random() * 1500;
      b.frequency.setValueAtTime(f, t); b.frequency.exponentialRampToValueAtTime(f * (0.6 + Math.random() * 0.9), t + d);
      const g = (0.035 + Math.random() * 0.04) * loud;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + d * 0.35); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(b); b.connect(v); v.connect(p); s.start(t, Math.random() * 1.5); s.stop(t + d + 0.02);
      t += d * (0.75 + Math.random() * 0.5);
    }
  },
  // One heartbeat, heard from inside the chest: lub, then a softer dub. k 0..1 is how hard it is pounding.
  heartbeat(k = 0.5) {
    if (!ctx) return;
    const thump = (t, f, g, d) => {
      const o = ctx.createOscillator(), v = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'sine'; o.frequency.setValueAtTime(f * 1.9, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + d);
      lp.type = 'lowpass'; lp.frequency.value = 160;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.012); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(lp); lp.connect(v); v.connect(master); o.start(t); o.stop(t + d + 0.05);
      const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), nv = ctx.createGain();
      s.buffer = noiseBuf; b.type = 'lowpass'; b.frequency.value = 110;
      nv.gain.setValueAtTime(g * 0.9, t); nv.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      s.connect(b); b.connect(nv); nv.connect(master); s.start(t, Math.random()); s.stop(t + 0.08);
    };
    const t = ctx.currentTime + 0.01, g = 0.22 + k * 0.5, gap = 0.2 - k * 0.07;
    thump(t, 52, g, 0.17); thump(t + gap, 44, g * 0.68, 0.2);
  },
  // Your own breath, close and inside the head. inhale: air drawn in, brightening; exhale: longer, falling, a little shaky when k (fear) is high.
  breath(inhale, d = 3, k = 0.5) {
    if (!ctx) return { stop() {} };
    const t = ctx.currentTime, s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter(), v = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    b.type = 'bandpass'; b.Q.value = 0.9; b2.type = 'lowpass'; b2.frequency.value = inhale ? 5200 : 2600;
    const g = 0.05 + k * 0.05;
    if (inhale) {
      b.frequency.setValueAtTime(700, t); b.frequency.exponentialRampToValueAtTime(2100, t + d);
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + d * 0.3); v.gain.setValueAtTime(g, t + d * 0.8); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    } else {
      b.frequency.setValueAtTime(1500, t); b.frequency.exponentialRampToValueAtTime(420, t + d);
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g * 1.25, t + 0.18); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    }
    s.connect(b); b.connect(b2);
    if (k > 0.35) { // the shake in a frightened breath
      const l = ctx.createOscillator(), lg = ctx.createGain(), tr = ctx.createGain();
      l.frequency.value = 9 + k * 6; lg.gain.value = (k - 0.35) * 0.9; tr.gain.value = 1;
      l.connect(lg); lg.connect(tr.gain); b2.connect(tr); tr.connect(v); l.start(t); l.stop(t + d + 0.1);
    } else b2.connect(v);
    v.connect(master); s.start(t, Math.random()); s.stop(t + d + 0.1);
    return { stop(sec = 0.25) { const n = ctx.currentTime; v.gain.cancelScheduledValues(n); v.gain.setValueAtTime(Math.max(v.gain.value, 0.0001), n); v.gain.exponentialRampToValueAtTime(0.0001, n + sec); } };
  },
  // A djinn at your ear: a breathy voice-like murmur (noise through two moving vowel formants, in syllables), sliding across the head.
  murmur(pan = (Math.random() * 2 - 1) * 0.9, loud = 1) {
    if (!ctx || crowded()) return;
    let t = ctx.currentTime + 0.02;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); p.connect(master);
    const syll = 5 + Math.floor(Math.random() * 9), total = syll * 0.17;
    if (p.pan) { p.pan.setValueAtTime(pan, t); p.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, pan + (Math.random() - 0.5) * 1.2)), t + total); }
    const V = [[700, 1150], [320, 2300], [420, 900], [550, 1750], [300, 800]];
    const low = 0.75 + Math.random() * 0.5;
    for (let i = 0; i < syll; i++) {
      const d = 0.09 + Math.random() * 0.14, vw = V[Math.floor(Math.random() * V.length)], vw2 = V[Math.floor(Math.random() * V.length)];
      const s = ctx.createBufferSource(), v = ctx.createGain(); s.buffer = noiseBuf;
      for (let k = 0; k < 2; k++) {
        const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = 7 + Math.random() * 5;
        b.frequency.setValueAtTime(vw[k] * low, t); b.frequency.linearRampToValueAtTime(vw2[k] * low, t + d);
        const bg = ctx.createGain(); bg.gain.value = k ? 0.6 : 1; s.connect(b); b.connect(bg); bg.connect(v);
      }
      if (Math.random() < 0.45) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 5000; const hg = ctx.createGain(); hg.gain.setValueAtTime(0.5, t); hg.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(h); h.connect(hg); hg.connect(v); }
      const g = (0.12 + Math.random() * 0.1) * loud;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + d * 0.3); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      v.connect(p); s.start(t, Math.random() * 1.5); s.stop(t + d + 0.02);
      t += d * (0.7 + Math.random() * 0.6);
    }
  },
  // Laughter that is not quite a throat: a run of "ha"s that speeds up and climbs or falls, with a metallic ring under it and an echo.
  cackle(pan = (Math.random() * 2 - 1) * 0.8, loud = 1) {
    if (!ctx || crowded()) return;
    let t = ctx.currentTime + 0.02;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = pan;
    const echo = ctx.createDelay(0.6); echo.delayTime.value = 0.21; const eg = ctx.createGain(); eg.gain.value = 0.35;
    p.connect(master); p.connect(echo); echo.connect(eg); eg.connect(master);
    // maniacal, not polite: a sharp wheezing gasp in, then a fast, accelerating run of high "hee"s whose pitch lurches about
    // and climbs, broken by sudden shrieks
    { const s0 = ctx.createBufferSource(), hb = ctx.createBiquadFilter(), hv = ctx.createGain(); s0.buffer = noiseBuf; hb.type = 'bandpass'; hb.Q.value = 3;
      hb.frequency.setValueAtTime(1200, t); hb.frequency.exponentialRampToValueAtTime(3800, t + 0.22);
      hv.gain.setValueAtTime(0.0001, t); hv.gain.exponentialRampToValueAtTime(0.05 * loud, t + 0.18); hv.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      s0.connect(hb); hb.connect(hv); hv.connect(p); s0.start(t, Math.random()); s0.stop(t + 0.26); t += 0.26; }
    const n = 9 + Math.floor(Math.random() * 9); let f0 = 300 + Math.random() * 180, gap = 0.12;
    for (let i = 0; i < n; i++) {
      const shriek = i > 2 && Math.random() < 0.18, d = shriek ? 0.2 : 0.075, o = ctx.createOscillator(), v = ctx.createGain(), b = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter();
      const fj = f0 * (0.85 + Math.random() * 0.35) * (shriek ? 1.7 : 1);
      o.type = 'sawtooth'; o.frequency.setValueAtTime(fj * (shriek ? 0.9 : 1.25), t); o.frequency.exponentialRampToValueAtTime(fj * (shriek ? 1.35 : 0.8), t + d);
      b.type = 'bandpass'; b.frequency.value = Math.random() < 0.6 ? 500 : 800; b.Q.value = 5; b2.type = 'bandpass'; b2.frequency.value = 2300 + Math.random() * 500; b2.Q.value = 6;
      const g = 0.12 * loud * (shriek ? 1.25 : 1 - i / (n * 3));
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.015); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(b); o.connect(b2); b.connect(v); b2.connect(v);
      const s = ctx.createBufferSource(), sb = ctx.createBiquadFilter(), sv = ctx.createGain(); s.buffer = noiseBuf; sb.type = 'bandpass'; sb.frequency.value = 2400; sb.Q.value = 1.2;
      sv.gain.setValueAtTime(g * 0.5, t); sv.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); s.connect(sb); sb.connect(sv); sv.connect(v);
      v.connect(p); o.start(t); o.stop(t + d + 0.02); s.start(t, Math.random()); s.stop(t + 0.06);
      f0 *= 1.03; gap = Math.max(0.065, gap * 0.94); t += shriek ? d + 0.03 : gap;
    }
  },
  // debug: an analyser on the master bus, for measuring levels in tests
  tap() { if (!ctx) return null; if (!A._an) { A._an = ctx.createAnalyser(); A._an.fftSize = 2048; master.connect(A._an); } return A._an; },
  // A tone that creeps in out of silence: starts inaudible and swells over sec seconds; with opt.to it also climbs
  // (or falls) in pitch over the same time. Every "a tone builds" moment uses this, so one change tunes them all.
  // Returns the drone handle (set, swell, stop).
  rise(f, gain, sec = 8, opt = {}) {
    const { to, ...rest } = opt;
    const h = A.drone(f, { ...rest, g: 0.0001, fade: 0.1 });
    h.swell(gain, sec * RISE_SLOW);
    if (to) h.set(to, undefined, sec * RISE_SLOW * 1.1);
    return h;
  },
  // The carrier wave as people report it: a deep vibrating hum with an electrical buzz in it, pulsing "wah-wah-wah",
  // and over it a high ringing whine. As it climbs the pulse speeds up until it blurs into one continuous tone and the
  // whine comes forward, shimmering between the ears. f is the hum; the whine sits three octaves up (opt.hi, x8: 85 Hz hum ->
  // 680 Hz whine, 175 Hz -> 1.4 kHz). opt.to climbs the whole thing over sec, as A.rise does.
  // set(f, gain, sec) moves it (higher = faster pulse, louder whine); swell(gain, sec); stop(sec).
  carrier(f, gain, sec = 8, opt = {}) {
    if (!ctx) return { set() {}, swell() {}, stop() {} };
    const t = ctx.currentTime, S = sec * RISE_SLOW, to = opt.to || f, HI = opt.hi || 8;
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const rate = (x) => clamp(3 + 21 * (x / f - 1) / 0.9, 3, 24);                  // pulses per second, faster as the pitch climbs
    const depth = (x) => (rate(x) > 15 ? 0.22 : 0.5);                  // fast pulsing smears into a steady tone
    const shine = (x) => clamp((x - f * 0.9) / (f * 0.6), 0.12, 1);    // how far forward the whine is
    const ramp = (p, v, n, s) => { p.cancelScheduledValues(n); p.setValueAtTime(p.value, n); p.linearRampToValueAtTime(v, n + s); };
    const xramp = (p, v, n, s) => { p.cancelScheduledValues(n); p.setValueAtTime(Math.max(p.value, 0.0001), n); p.exponentialRampToValueAtTime(v, n + s); };
    const bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(master);
    const L = track(0.0001, 0.0001, t, t, true);
    // the pulse: a wobble in level whose rate climbs with the pitch
    const pulse = ctx.createGain(); pulse.gain.value = 1 - depth(f); pulse.connect(bus);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = rate(f); lg.gain.value = depth(f);
    lfo.connect(lg); lg.connect(pulse.gain);
    const hi = ctx.createGain(); hi.gain.value = 0.0001; hi.connect(pulse);   // the whine's own level, so it can arrive late
    const srcs = [lfo], fq = [];   // fq: [AudioParam, multiple of the hum, offset Hz]
    const osc = (type, m, d, g, out, pan) => {
      const o = ctx.createOscillator(), v = ctx.createGain(); o.type = type; o.frequency.value = f * m + d; v.gain.value = g;
      o.connect(v);
      if (pan !== undefined && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; v.connect(p); p.connect(out); } else v.connect(out);
      srcs.push(o); fq.push([o.frequency, m, d]); return o;
    };
    osc('triangle', 1, 0, 1, pulse);            // the hum
    osc('sine', 2, 1.7, 0.5, pulse);            // its octave a hair sharp: the two beat, the doubled sound
    { // the electrical buzz: a sawtooth with only its upper partials let through
      const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = 2.5; b.frequency.value = f * 5; b.connect(pulse);
      osc('sawtooth', 2, -1.3, 0.55, b); fq.push([b.frequency, 5, 0]);
    }
    osc('sine', HI, 0, 0.3, hi, -0.7);         // the whine, one copy in each ear a few Hz apart, so it shimmers across the head
    osc('sine', HI, 4.5, 0.3, hi, 0.7);
    { // a thin fizz of noise round the whine
      const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true;
      b.type = 'bandpass'; b.Q.value = 9; b.frequency.value = f * HI; v.gain.value = 0.35; s.connect(b); b.connect(v); v.connect(hi);
      srcs.push(s); fq.push([b.frequency, HI, 0]);
    }
    for (const s of srcs) s.start(t, s.buffer ? Math.random() : undefined);
    const move = (x, n, s) => {
      for (const [p, m, d] of fq) xramp(p, x * m + d, n, s);
      xramp(lfo.frequency, rate(x), n, s); ramp(lg.gain, depth(x), n, s); ramp(pulse.gain, 1 - depth(x), n, s);
      ramp(hi.gain, shine(x), n, s);
    };
    const h = {
      // level climbs evenly in decibels, eased at both ends (as drone.swell)
      swell(g1, s = 6) {
        s = sp(s);
        const n = ctx.currentTime, g = Math.max(g1, 0.0001), from = L.go(g, n + s, true), N = 64, c = new Float32Array(N);
        const lo = Math.max(Math.min(from, g), g * 0.03), up = g >= from;
        for (let i = 0; i < N; i++) { const k = i / (N - 1), e = k * k * (3 - 2 * k); c[i] = up ? lo * Math.pow(g / lo, e) : from * Math.pow(g / from, e); }
        c[0] = Math.max(from, 0.0001);
        try { bus.gain.cancelScheduledValues(n); bus.gain.setValueCurveAtTime(c, n, s); } catch (_) { bus.gain.linearRampToValueAtTime(g, n + s); }
      },
      set(f2, g2, s = 0.5) {
        s = sp(s);
        const n = ctx.currentTime;
        if (f2) move(f2, n, s);
        if (g2 !== undefined) { const from = L.go(g2, n + s, true); bus.gain.cancelScheduledValues(n); bus.gain.setValueAtTime(from, n); bus.gain.exponentialRampToValueAtTime(Math.max(g2, 0.0001), n + s); }
      },
      stop(s = 0.6) {
        const n = ctx.currentTime, from = L.go(0.0001, n + s, false);
        bus.gain.cancelScheduledValues(n); bus.gain.setValueAtTime(from, n); bus.gain.linearRampToValueAtTime(0.0001, n + s);
        for (const x of srcs) { try { x.stop(n + s + 0.1); } catch (_) {} }
        setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (s + 0.3) * 1000);
        live.delete(h);
      },
    };
    live.add(h);
    h.swell(gain, S);
    if (to !== f) move(to, t, sp(S) * 1.1); else ramp(hi.gain, shine(f), t, sp(S));
    return h;
  },
  // A far-off detonation: a deep crack, a long rolling rumble and a sub-bass push. v scales it.
  blast(v = 1) {
    A.noise(0.5, { g: 0.7 * v, f: 260, q: 0.6, type: 'lowpass', to: 60 });
    A.noise(6, { g: 0.85 * v, f: 110, q: 0.5, type: 'lowpass', to: 28 });
    A.tone(46, 5, { g: 0.5 * v, to: 22 }); A.tone(31, 6, { g: 0.4 * v, to: 18 });
    setTimeout(() => A.noise(4, { g: 0.35 * v, f: 70, q: 0.5, type: 'lowpass', to: 25 }), 900);
  },
  // A low, slow, mocking laugh: "heh... heh... heh-heh-haaa", a deep voiced throat through vowel formants, falling in pitch,
  // with breath on each syllable and a dark echo behind it. pan -1 (left) to 1 (right).
  mock(pan = (Math.random() * 2 - 1) * 0.8, loud = 1) {
    if (!ctx || crowded()) return;
    let t = ctx.currentTime + 0.02;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = pan;
    const echo = ctx.createDelay(1); echo.delayTime.value = 0.33; const eg = ctx.createGain(); eg.gain.value = 0.3; const el = ctx.createBiquadFilter(); el.type = 'lowpass'; el.frequency.value = 1100;
    p.connect(master); p.connect(echo); echo.connect(el); el.connect(eg); eg.connect(echo); eg.connect(master);
    const n = 5 + Math.floor(Math.random() * 5); let f0 = 170 + Math.random() * 90, gap = 0.17 + Math.random() * 0.04;
    const F = Math.random() < 0.5 ? [520, 1500] : [700, 1150];   // "heh" or "hah"
    for (let i = 0; i < n; i++) {
      const last = i === n - 1, d = last ? 0.6 + Math.random() * 0.3 : 0.09 + Math.random() * 0.03;
      const o = ctx.createOscillator(), v = ctx.createGain();
      const fj = f0 * (0.9 + Math.random() * 0.25);
      o.type = 'sawtooth';
      if (last) { o.frequency.setValueAtTime(fj, t); o.frequency.exponentialRampToValueAtTime(fj * 1.9, t + d * 0.45); o.frequency.exponentialRampToValueAtTime(fj * 0.7, t + d); }
      else { o.frequency.setValueAtTime(fj * 1.2, t); o.frequency.exponentialRampToValueAtTime(fj * 0.82, t + d); }
      for (let k = 0; k < 2; k++) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = F[k] * (0.9 + Math.random() * 0.15); b.Q.value = 6; const bg = ctx.createGain(); bg.gain.value = k ? 0.55 : 1; o.connect(b); b.connect(bg); bg.connect(v); }
      const s = ctx.createBufferSource(), sb = ctx.createBiquadFilter(), sv = ctx.createGain(); s.buffer = noiseBuf; sb.type = 'bandpass'; sb.frequency.value = 1400; sb.Q.value = 0.8;
      const g = 0.16 * loud * (last ? 0.9 : 1 - i * 0.08);
      sv.gain.setValueAtTime(g * 0.6, t); sv.gain.exponentialRampToValueAtTime(0.0001, t + 0.07 + (last ? 0.2 : 0)); s.connect(sb); sb.connect(sv); sv.connect(v);
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.02); v.gain.setValueAtTime(g, t + d * 0.4); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      v.connect(p); o.start(t); o.stop(t + d + 0.05); s.start(t, Math.random()); s.stop(t + d + 0.05);
      f0 *= 1.07; t += last ? d : gap; gap = Math.max(0.08, gap * 0.85);
    }
    // the echo feeds back into itself, so it never quite reaches silence and the browser keeps running it: close the
    // loop 2 s after the last syllable (about six repeats, the last one 30 dB down) and disconnect it all
    eg.gain.setValueAtTime(0.3, t + 2); eg.gain.linearRampToValueAtTime(0, t + 2.4);
    setTimeout(() => { for (const nd of [p, echo, el, eg]) try { nd.disconnect(); } catch (_) {} }, (t + 2.6 - ctx.currentTime) * 1000);
  },
  // One tone in the left ear, another in the right. The ear hears the difference between them as a slow beat.
  // Returns { diff(hz), level(gain, seconds), stop(seconds) }.
  binaural(base = 180, d = 10) {
    if (!ctx) return { diff() {}, level() {}, stop() {} };
    const t = ctx.currentTime, v = ctx.createGain(); v.gain.value = 0.0001; v.gain.setValueAtTime(0.0001, t); v.connect(master);
    const LV = track(0.0001, 0.0001, t, t, false);
    const mk = (f, pan) => { const o = ctx.createOscillator(); o.frequency.value = f; const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = pan; o.connect(p); p.connect(v); o.start(t); return o; };
    const L = mk(base, -1), R = mk(base + d, 1);
    const h = {
      diff(hz) { R.frequency.setTargetAtTime(base + hz, ctx.currentTime, 0.05); },
      level(g, sec = 2) { const n = ctx.currentTime, from = LV.go(g, n + sec, false); v.gain.cancelScheduledValues(n); v.gain.setValueAtTime(from, n); v.gain.linearRampToValueAtTime(Math.max(g, 0.0001), n + sec); },
      stop(sec = 1) { const n = ctx.currentTime; h.level(0.0001, sec); try { L.stop(n + sec + 0.1); R.stop(n + sec + 0.1); } catch (_) {} live.delete(h); },
    };
    live.add(h);
    return h;
  },
  // Pause holds the output silent instead of suspending the context. A suspended context stops its clock, but the
  // scenes' wall-clock timers (loops that schedule ahead every few seconds) kept running, so a long pause queued minutes
  // of future nodes on a frozen clock; after it the audio thread could not keep up (the clock ran at 0.4x: crackling, then
  // dropouts) until that backlog had played out, into the next scene. With the clock running, timers and clock agree.
  suspend() { held = true; if (ctx && out) { const n = ctx.currentTime; out.gain.cancelScheduledValues(n); out.gain.setTargetAtTime(0, n, 0.015); } },
  resume() { held = false; if (ctx) { if (ctx.state === 'suspended') ctx.resume(); if (out) { const n = ctx.currentTime; out.gain.cancelScheduledValues(n); out.gain.setTargetAtTime(muted ? 0 : 1, n, 0.03); } } },
  click() { A.noise(0.03, { g: 0.25, f: 3200, q: 6 }); },
  clicks(n = 4) { if (paced('clicks', 2)) return; for (let i = 0; i < n; i++) setTimeout(A.click, i * 70 + Math.random() * 50); },
  zap() { A.noise(0.9, { g: 0.6, f: 4000, q: 0.6, to: 200 }); A.tone(90, 0.9, { type: 'sawtooth', g: 0.35, to: 30 }); },
  // ethereal swell: a slow-blooming cluster of soft, slightly detuned sines (root, fifth, octave, a high partial) with a breath
  // of high air under it; nothing struck, nothing plucked. f = root, d = length in seconds
  shimmer(f = 520, d = 4, g = 0.025) {
    for (const [m, gm, dt] of [[1, 1, 0], [1.0035, 0.8, 0.15], [1.5, 0.55, 0.3], [2, 0.45, 0.45], [3.01, 0.18, 0.6]]) A.tone(f * m, d - dt * 0.5, { g: g * gm, a: d * 0.38 + dt });
    A.noise(d * 0.9, { g: g * 0.5, f: 6000, q: 0.7 });
  },
  // One bare footstep (the player is barefoot all night). surf: carpet, ship (smooth hard floor), deck (polished plating,
  // hollow under it), hall (hard, big echoing space), stone, wood, grass. k = weight (0.3 creeping .. 1 striding), side -1/1.
  step(surf = 'ship', k = 1, side = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.005, j = 0.88 + Math.random() * 0.24;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = side * 0.15;
    p.connect(master);
    const burst = (at, d, f, q, g, type = 'bandpass', to = null) => {
      const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf;
      b.type = type; b.Q.value = q; b.frequency.setValueAtTime(f, at); if (to) b.frequency.exponentialRampToValueAtTime(to, at + d);
      v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), at + 0.006); v.gain.exponentialRampToValueAtTime(0.0001, at + d);
      s.connect(b); b.connect(v); v.connect(p); s.start(at, Math.random() * 1.5); s.stop(at + d + 0.02);
    };
    const thud = (at, f, d, g) => {
      const o = ctx.createOscillator(), v = ctx.createGain(); o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 0.55, at + d);
      v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), at + 0.008); v.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(v); v.connect(p); o.start(at); o.stop(at + d + 0.02);
    };
    const ring = (at, f, d, g) => { for (const [m, gm] of [[1, 1], [2.76, 0.4], [5.4, 0.15]]) A.toneAt(at, f * m, d / Math.sqrt(m), g * gm, p); };
    // a bare foot: heel, then the ball of the foot a beat later, skin on the surface
    const foot = (at, bright, g) => { thud(at, 80 * j, 0.07, 0.13 * g); burst(at, 0.05, 900 * j * bright, 1.1, 0.08 * g); burst(at + 0.075 + Math.random() * 0.02, 0.045, 1300 * j * bright, 1.3, 0.05 * g); };
    if (surf === 'carpet') { thud(t, 62 * j, 0.1, 0.14 * k); burst(t, 0.13, 420 * j, 0.7, 0.05 * k, 'lowpass'); burst(t + 0.04, 0.12, 2200, 0.9, 0.008 * k); }
    else if (surf === 'grass') { thud(t, 60 * j, 0.08, 0.08 * k); for (let i = 0; i < 7; i++) burst(t + i * 0.022 + Math.random() * 0.015, 0.03, 2500 + Math.random() * 4000, 2.5, 0.025 * k * (1 - i / 9)); }
    else if (surf === 'wood') { foot(t, 0.8, k); ring(t, 150 * j, 0.18, 0.03 * k); if (Math.random() < 0.15) A.tone(310 * j, 0.25, { type: 'sawtooth', g: 0.006 * k, a: 0.06, to: 250 * j }); }
    else if (surf === 'stone') { foot(t, 1.15, k); burst(t + 0.02, 0.03, 4200, 2, 0.01 * k); }
    else if (surf === 'deck') { foot(t, 1.05, k); ring(t, 118 * j, 0.5, 0.022 * k); }
    else if (surf === 'hall') { for (const [dl, gm] of [[0, 1], [0.21, 0.3], [0.43, 0.12]]) { foot(t + dl, dl ? 0.7 : 1, k * gm); } ring(t, 96 * j, 0.7, 0.012 * k); }
    else { foot(t, 1, k); ring(t, 200 * j, 0.25, 0.009 * k); }   // ship
    setTimeout(() => { try { p.disconnect(); } catch (_) {} }, 1500);
  },
  // Your own voice coming back after the paralysis: a dry, cracked croak. A low strangled vocal fry (an uneven pulse under
  // 70 Hz) through an open "aah" mouth, catching once into a higher break, with rough breath round it.
  croak(d = 1.1) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator(), j = ctx.createOscillator(), jg = ctx.createGain(), v = ctx.createGain(), mix = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(58, t); o.frequency.linearRampToValueAtTime(74, t + d * 0.3);
    o.frequency.setValueAtTime(74, t + d * 0.42); o.frequency.linearRampToValueAtTime(190, t + d * 0.46);   // the voice cracks up
    o.frequency.linearRampToValueAtTime(66, t + d * 0.56); o.frequency.exponentialRampToValueAtTime(44, t + d);
    j.type = 'square'; j.frequency.value = 17; jg.gain.value = 9; j.connect(jg); jg.connect(o.frequency);   // uneven pulse: the fry
    o.connect(mix);
    const s = ctx.createBufferSource(), sg = ctx.createGain(); s.buffer = noiseBuf; s.loop = true; sg.gain.value = 0.45; s.connect(sg); sg.connect(mix);
    for (const [f, q, g] of [[640, 6, 1], [1080, 7, 0.7], [2450, 8, 0.3]]) {
      const b = ctx.createBiquadFilter(), bg = ctx.createGain(); b.type = 'bandpass'; b.Q.value = q; b.frequency.setValueAtTime(f * 0.9, t); b.frequency.linearRampToValueAtTime(f, t + d * 0.4);
      bg.gain.value = g; mix.connect(b); b.connect(bg); bg.connect(v);
    }
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.32, t + 0.08); v.gain.setValueAtTime(0.32, t + d * 0.45);
    v.gain.exponentialRampToValueAtTime(0.22, t + d * 0.6); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    v.connect(master);
    o.start(t); j.start(t); s.start(t, Math.random()); o.stop(t + d + 0.05); j.stop(t + d + 0.05); s.stop(t + d + 0.05);
  },
  // The child's gift: a faint, glassy hum that breathes, close to the edge of hearing, with now and then a single high glint.
  // Returns { set(level 0..1), stop(sec) }; the scene sets level by how near it is.
  aura(f = 293.66) {
    if (!ctx) return { set() {}, stop() {} };
    const hs = [[f, 'sine', 0.5], [f * 1.004, 'sine', 0.4], [f * 1.5, 'sine', 0.22], [f * 2.997, 'sine', 0.1]].map(([fr, type, g]) => [A.drone(fr, { type, g: 0.0001, fade: 0.1 }), g]);
    const air = A.drone(f * 8, { noise: true, q: 14, g: 0.0001, fade: 0.1 });
    let lvl = 0, alive = true, last = -1;
    const tick = () => {
      if (!alive || !live.has(hs[0][0])) return;
      if (lvl > 0.05 && Math.random() < 0.35 * lvl) {
        const tt = ctx.currentTime + Math.random() * 0.5;
        A.toneAt(tt, f * [4, 5, 6, 8][Math.floor(Math.random() * 4)] * (1 + (Math.random() - 0.5) * 0.004), 1.6 + Math.random(), 0.004 * lvl);
      }
      setTimeout(tick, 700 + Math.random() * 900);
    };
    tick();
    return {
      set(l) {
        l = Math.max(0, Math.min(1, l)); if (Math.abs(l - last) < 0.02) return; last = l; lvl = l;
        const G0 = 0.03;
        for (const [h, g] of hs) h.set(undefined, G0 * g * l, 0.4);
        air.set(undefined, 0.006 * l, 0.4);
      },
      stop(sec = 1) { alive = false; for (const [h] of hs) h.stop(sec); air.stop(sec); },
    };
  },
  // ---- cue sounds (layered physical sounds, no sine chimes) ----
  // Shared pieces. air(): a band of noise with its own swell and glide (wind, breath, rushes). body(): struck or rubbed
  // resonance made by exciting high-Q filters with noise, so it rings like a real object (bowl, glass, hull) and not a sine.
  // thump(): a low pressure push. Each takes a start time, so a cue can be laid out as a little score.
  _air(at, d, f0, f1, q, g, { atk = 0.4, pan = 0, dest = null } = {}) {
    const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true;
    b.type = 'bandpass'; b.Q.value = q; b.frequency.setValueAtTime(f0, at); b.frequency.exponentialRampToValueAtTime(f1, at + d);
    v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(g, at + d * atk); v.gain.exponentialRampToValueAtTime(0.0001, at + d);
    let out = v; if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; v.connect(p); out = p; }
    s.connect(b); b.connect(v); out.connect(dest || master); s.start(at, Math.random()); s.stop(at + d + 0.05);
  },
  _body(at, freqs, d, g, { q = 160, strike = 0.004, swell = 0, dest = null } = {}) {
    // noise burst (or a slow rub when swell > 0) into a bank of resonators; higher modes die faster, as in a real object
    const s = ctx.createBufferSource(), e = ctx.createGain(); s.buffer = noiseBuf; s.loop = true;
    e.gain.setValueAtTime(0.0001, at);
    if (swell) { e.gain.exponentialRampToValueAtTime(1, at + swell); e.gain.exponentialRampToValueAtTime(0.0001, at + swell + 0.6); }
    else { e.gain.exponentialRampToValueAtTime(1, at + strike); e.gain.exponentialRampToValueAtTime(0.0001, at + strike + 0.03); }
    s.connect(e);
    freqs.forEach((f, i) => {
      const b = ctx.createBiquadFilter(), v = ctx.createGain(), dd = d / (1 + i * 0.5); b.type = 'bandpass'; b.Q.value = q; b.frequency.value = f;
      const gg = g * (q / 40) * (swell ? 30 : 150) / (1 + i * 0.6);   // a narrow filter passes very little energy: scale well back up (calibrated by measurement, build 95)
      v.gain.setValueAtTime(gg, at); v.gain.setValueAtTime(gg, at + (swell || 0)); v.gain.exponentialRampToValueAtTime(0.0001, at + (swell || 0) + dd);
      e.connect(b); b.connect(v); v.connect(dest || master);
    });
    s.start(at, Math.random()); s.stop(at + (swell || 0) + d + 0.1);
  },
  _thump(at, f, d, g) {
    const o = ctx.createOscillator(), v = ctx.createGain(); o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 0.6, at + d);
    v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(g, at + Math.min(0.12, d * 0.2)); v.gain.exponentialRampToValueAtTime(0.0001, at + d);
    o.connect(v); v.connect(master); o.start(at); o.stop(at + d + 0.05);
  },
  // Glints: n tiny crystalline pings scattered over span seconds, each a noise tick into one very narrow resonator, so it
  // rings like a speck of glass or ice, not a sine. Random pitch from a bright scale between lo and hi Hz, random pan.
  // soft > 0 fades each one in over that many seconds (a twinkle) instead of striking it.
  _glints(at, span, n, lo, hi, g, decay = 0.6, soft = 0, bias = 1) {
    const SC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
    for (let i = 0; i < n; i++) {
      const tt = at + Math.pow(Math.random(), bias) * span;
      let fr = lo * Math.pow(2, Math.floor(Math.random() * Math.log2(hi / lo))) * SC[Math.floor(Math.random() * SC.length)];
      fr = Math.min(fr, hi);
      // a speck of glass: a tick of bright noise for the grain, and two inharmonic partials (1 : 2.76, as a small bar or
      // bell rings) that ring on and die; slightly detuned each time
      const gg = g * 5 * (0.4 + Math.random() * 0.6), dd = decay * (0.6 + Math.random() * 0.8), at2 = tt + (soft || 0.002);
      const v = ctx.createGain(); let out = v;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.8 - 0.9; v.connect(p); out = p; }
      out.connect(master); v.gain.value = 1;
      const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ne = ctx.createGain(); src.buffer = noiseBuf;
      bp.type = 'bandpass'; bp.Q.value = 18; bp.frequency.value = fr * 1.4;
      ne.gain.setValueAtTime(0.0001, tt); ne.gain.exponentialRampToValueAtTime(gg * 1.2, at2); ne.gain.exponentialRampToValueAtTime(0.0001, at2 + 0.03 + dd * 0.08);
      src.connect(bp); bp.connect(ne); ne.connect(v); src.start(tt, Math.random() * 1.5); src.stop(at2 + 0.05 + dd * 0.08);
      for (const [m, gm, dm] of [[1, 1, 1], [2.756, 0.35, 0.45]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = fr * m * (1 + (Math.random() - 0.5) * 0.006);
        og.gain.setValueAtTime(0.0001, tt); og.gain.exponentialRampToValueAtTime(gg * 0.5 * gm, at2); og.gain.exponentialRampToValueAtTime(0.0001, at2 + dd * dm);
        o.connect(og); og.connect(v); o.start(tt); o.stop(at2 + dd * dm + 0.05);
      }
    }
  },
  // Classroom: the turned sky drops into place. Starry: a soft breath of high air as it slides home, a light low landing,
  // and the stars answering, dozens of faint twinkles fading in and out across the head and lingering after.
  settle() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    A._air(t, 1.2, 3000, 900, 0.8, 0.025, { atk: 0.2 });
    A._thump(t + 0.45, 58, 1.2, 0.12);
    A._air(t + 0.4, 4.5, 9000, 6500, 1.2, 0.008, { atk: 0.3, pan: -0.4 });     // starlight hiss, wide
    A._air(t + 0.45, 4.5, 9500, 7000, 1.2, 0.008, { atk: 0.3, pan: 0.4 });
    A._glints(t + 0.4, 0.5, 10, 1600, 6000, 0.012, 1.2);                       // the first stars catch as it lands
    A._glints(t + 0.6, 4, 34, 1400, 7500, 0.009, 1.6, 0.08, 1.6);              // then the whole sky twinkling, thinning out
  },
  // Classroom orb changing form (stage 1 or 2): snappy and sparkly. A quick bright snap as it changes, a tight shard of
  // crystal ringing, and a spray of glitter thrown off it, higher and denser at the second stage.
  bloom(stage = 1) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02, k = stage > 1 ? 1.26 : 1;
    A._air(t, 0.16, 900 * k, 5200 * k, 1.2, 0.05, { atk: 0.7 });               // the quick suck in
    A._air(t + 0.15, 0.09, 6000, 2500, 0.9, 0.06, { atk: 0.05 });               // the snap
    A._thump(t + 0.15, 110 * k, 0.25, 0.1);
    A._body(t + 0.15, [880 * k, 1326 * k, 2374 * k], 1.4, 0.02, { q: 300, strike: 0.002 });
    A._glints(t + 0.16, 0.35, 16 + stage * 8, 2200 * k, 9000, 0.014, 0.5, 0, 2.2);   // glitter, bunched at the snap
    A._glints(t + 0.4, 1.2, 8, 3000, 9000, 0.006, 0.8, 0.03, 1.5);             // a few last flecks settling
  },
  // Classroom: the orb is done and comes to you. A sharp bright crack of release, a short rush of air towards you, and a
  // long sparkling trail that follows it in.
  // Exam room: the eye on its stalk stops over your face, reads you and lets go. Cold and clinical, like hospital
  // equipment: a soft heavy magnetic clunk as it locks, a cold electrical hum that swells while it reads (two close
  // pitches beating, through a filter that opens and closes). Lasts about 1.4 s, the length of the colour change.
  // Build 126: no air or noise layers at all. The puff of air
  // on the clunk and the scan-bar sweep across and back are gone. Do not add noise sweeps back to this cue.
  scanLock() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the lock: a soft, heavy, muffled magnetic clunk
    A._thump(t, 85, 0.25, 0.3);
    // the read: a cold electrical hum swelling and holding while it reads
    {
      const f = ctx.createBiquadFilter(), v = ctx.createGain(); f.type = 'lowpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.5); f.frequency.exponentialRampToValueAtTime(800, t + 1.3);
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.05, t + 0.18); v.gain.setValueAtTime(0.05, t + 0.95); v.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
      f.connect(v); v.connect(master);
      for (const [fr, ty] of [[110, 'sawtooth'], [111.3, 'sawtooth'], [220.4, 'square']]) { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 1.4); }
    }
  },
  // Bedclothes moving, as you sit up in bed (no flop) or drag the covers off (flop: the covers land). Build 106's soft
  // low drag of the covers, with no strokes, chosen from every version tried (build 111 developer menu).
  rustle(d = 1.2, g = 1, { flop = false } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the weight of the covers: a soft low drag
    A._air(t, d, 240, 420, 0.7, 0.25 * g, { atk: 0.4 });
    // the covers landing: a soft heavy flop
    if (flop) { A._thump(t + d, 75, 0.25, 0.07 * g); A._air(t + d, 0.4, 700, 280, 0.8, 0.06 * g, { atk: 0.08 }); }
  },
  // A small mantis on the stone sill outside the window, heard through the glass (the Communion morning): tiny dry sounds,
  // close to nothing. kind 'hook': a foreleg's hook catching on the sill's edge; 'step': a foot set down; 'settle': the
  // body's weight coming down onto its legs.
  mantisSill(kind = 'hook', g = 1) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.01, j = 0.9 + Math.random() * 0.2, k = kind === 'hook' ? 1 : kind === 'step' ? 0.55 : 0.5;
    // the claw: a dry tick of chitin on painted stone
    A._air(t, 0.014, 4300 * j, 4300 * j, 2.2, 0.05 * g * k, { atk: 0.08 });
    // the stone answering: a short, damped knock in the sill under the glass
    A._body(t, [1240 * j, 2050 * j, 3320 * j], 0.05, 0.01 * g * k, { q: 30, strike: 0.002 });
    // grit under the hook as it takes hold (it drags a millimetre)
    if (kind === 'hook') A._air(t + 0.006, 0.045, 6800, 6800, 1.3, 0.012 * g, { atk: 0.3 });
    // the weight: a soft low tap through the legs
    if (kind === 'settle') A._thump(t, 210 * j, 0.06, 0.01 * g);
  },
  release() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    A._air(t, 0.1, 7000, 3000, 0.9, 0.07, { atk: 0.05 });
    A._thump(t, 90, 0.35, 0.14);
    A._body(t, [660, 990, 1485, 2228], 2, 0.022, { q: 300, strike: 0.002 });
    A._glints(t + 0.01, 0.3, 26, 2400, 9500, 0.014, 0.5, 0, 2.5);
    A._air(t + 0.1, 1.1, 500, 2200, 0.7, 0.04, { atk: 0.4, pan: -0.3 });
    A._air(t + 0.15, 1.1, 560, 2500, 0.7, 0.035, { atk: 0.4, pan: 0.3 });
    A._glints(t + 0.3, 2.2, 30, 2000, 9000, 0.008, 0.7, 0.02, 1.4);            // the trail
  },
  // A voice arriving inside your head with no sound in the room: pressure in the ears, a close breath at the centre of the
  // head, and a thin ringing that flares and fades, as people describe telepathic speech beginning.
  inner() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    A._thump(t, 38, 1.8, 0.2);
    A._air(t, 1.4, 90, 60, 0.6, 0.12, { atk: 0.45 });                 // pressure
    A._air(t + 0.2, 1.1, 900, 1700, 1.0, 0.03, { atk: 0.5 });          // a close inhale, centred
    A._air(t + 0.3, 2.4, 6100, 6300, 40, 0.012, { atk: 0.3, pan: -0.15 });   // ear ringing, a hair apart in each ear
    A._air(t + 0.3, 2.4, 6180, 6400, 40, 0.012, { atk: 0.3, pan: 0.15 });
  },
  // Exam: holding the tall one's gaze, their eyes open into a night sky. The room falls away: the floor drops out of the
  // sound, a vast slow wind rises on both sides, and a distant deep resonance blooms as if from very far below.
  vast() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    A._thump(t, 45, 3.5, 0.2);
    A._air(t, 5, 160, 700, 0.5, 0.07, { atk: 0.6, pan: -0.6 });
    A._air(t + 0.2, 5, 190, 820, 0.5, 0.07, { atk: 0.6, pan: 0.6 });
    A._air(t + 0.6, 4.4, 3000, 9000, 0.8, 0.012, { atk: 0.7 });
    A._body(t + 0.8, [73, 110, 164, 219], 6, 0.05, { q: 90, swell: 2.2 });
  },
  // a sine at a set time, into a given node (for steps' resonances)
  toneAt(at, f, d, g, dest) {
    const o = ctx.createOscillator(), v = ctx.createGain(); o.frequency.value = f;
    v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), at + 0.004); v.gain.exponentialRampToValueAtTime(0.0001, at + d);
    o.connect(v); v.connect(dest || master); o.start(at); o.stop(at + d + 0.02);
  },
  // The bedroom doorway tearing open in the wall. Not magic: something wrong is happening to the room. The house strains
  // (deep creaks from the wall, the window rattling in its frame), the air is dragged out towards the wall, a low growl
  // beats against itself and climbs, the electrics overload and sputter, then
  // the pressure slams (ears), and a low unsteady roar is left hanging in the room. d = how long it takes to open.
  // Build 117: the wall creaks are off (creaks: true brings them back). The tear, removed in build 115, is back.
  // only: 'growl' | 'creaks' | 'rattle' | 'air' | 'electrics' | 'tear' | 'slam' | 'roar' plays one layer alone (sound list).
  // Levels measured layer by layer offline (build 100): every layer peaks 3-11 dB under the whole; re-measure if changed.
  portal(d = 2.6, { only = null, creaks = false } = {}) {
    if (!ctx) return;
    d = sp(d);
    const t = ctx.currentTime + 0.02, open = t + d * 0.95, R = Math.random;
    const on = (k) => (only ? only === k : k !== 'creaks' || creaks);
    const pan = (v) => { if (!ctx.createStereoPanner) return ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
    // jagged amplitude: a gain stepped at random every few ms between lo and hi, so a layer judders instead of gliding
    const jag = (g, from, to, step, lo, hi, env = () => 1) => { for (let x = from; x < to; x += step * (0.6 + R() * 0.8)) g.gain.setValueAtTime(Math.max(0.0001, (lo + R() * (hi - lo)) * env((x - from) / (to - from))), x); };
    const drive = ctx.createWaveShaper(); { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(3.2 * x); } drive.curve = c; }

    // 1. the growl: three detuned saws a tritone apart, beating, driven hard and lowpassed; the filter and pitch climb
    //    under the strain, so it opens from a felt throb into a snarl as the wall gives
    if (on('growl')) { const gl = ctx.createBiquadFilter(), gv = ctx.createGain(); gl.type = 'lowpass'; gl.Q.value = 4;
    gl.frequency.setValueAtTime(70, t); gl.frequency.exponentialRampToValueAtTime(520, open); gl.frequency.exponentialRampToValueAtTime(140, open + 6);
    gv.gain.setValueAtTime(0.0001, t); gv.gain.exponentialRampToValueAtTime(0.13, open); gv.gain.setValueAtTime(0.13, open + 0.4); gv.gain.exponentialRampToValueAtTime(0.0001, open + 6.5);
    for (const [f, w] of [[36, 1], [38.2, 0.8], [51, 0.55]]) {
      const o = ctx.createOscillator(), v = ctx.createGain(); o.type = 'sawtooth'; v.gain.value = w * 0.5;
      o.frequency.setValueAtTime(f * 0.94, t); o.frequency.exponentialRampToValueAtTime(f * 1.06, open); o.frequency.exponentialRampToValueAtTime(f * 0.9, open + 6);
      o.connect(v); v.connect(drive); o.start(t); o.stop(open + 6.6);
    }
    drive.connect(gl); gl.connect(gv); gv.connect(master); }

    // 2. the house straining: deep woody creaks from the wall, coming closer together as it opens
    if (on('creaks')) for (let x = 0.15; x < 0.92; x += 0.22 * (1.15 - x) * (0.6 + R() * 0.8)) {
      const at = t + x * d, f = 70 + R() * 60;
      A._body(at, [f, f * 2.3, f * 3.9], 0.5 + R() * 0.5, 0.2 + x * 0.3, { q: 18, swell: 0.08 + R() * 0.15 });
    }
    // the window rattling in its frame: dense irregular knocks of glass on wood, building with the pressure
    if (on('rattle')) { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter(), v = ctx.createGain(), p = pan(-0.55); s.buffer = noiseBuf; s.loop = true;
      b.type = 'bandpass'; b.frequency.value = 1900; b.Q.value = 3; b2.type = 'peaking'; b2.frequency.value = 420; b2.gain.value = 9; b2.Q.value = 2;
      v.gain.setValueAtTime(0.0001, t); jag(v, t + d * 0.25, open + 1.4, 0.028, 0, 0.9, (k) => (k < 0.7 ? k / 0.7 : (1 - k) / 0.3) ** 1.5);
      v.gain.setValueAtTime(0.0001, open + 1.45);
      s.connect(b); b.connect(b2); b2.connect(v); v.connect(p); p.connect(master); s.start(t, R()); s.stop(open + 1.5); }

    // 3. the air dragged out of the room towards the wall: a heavy low rush (not a hiss), swinging across the head
    if (on('air')) { A._air(t, d + 0.4, 90, 420, 0.9, 1.3, { atk: 0.9, pan: 0.2 });
      A._air(t + 0.3, d, 240, 900, 1.4, 0.6, { atk: 0.92, pan: -0.3 }); }

    // 4. the electrics overloading: mains buzz through a harsh band, sputtering and catching like a failing fitting
    if (on('electrics')) { const o = ctx.createOscillator(), o2 = ctx.createOscillator(), b = ctx.createBiquadFilter(), v = ctx.createGain(), p = pan(0.35); o.type = 'sawtooth'; o2.type = 'square';
      o.frequency.value = 100; o2.frequency.value = 50.4; b.type = 'bandpass'; b.Q.value = 1.6;
      b.frequency.setValueAtTime(900, t); b.frequency.exponentialRampToValueAtTime(2600, open);
      v.gain.setValueAtTime(0.0001, t); jag(v, t + d * 0.35, open + 0.25, 0.045, 0, 0.88, (k) => k * (R() < 0.25 ? 0.1 : 1));
      v.gain.setValueAtTime(0.0001, open + 0.3);
      o.connect(b); o2.connect(b); b.connect(v); v.connect(p); p.connect(master); o.start(t); o2.start(t); o.stop(open + 0.35); o2.stop(open + 0.35); }

    // 5. the tear: the wall rips like an enormous sheet giving way, a jagged band that falls from bright to deep, left to right
    if (on('tear')) { const ta = t + d * 0.62, td = d * 0.4 + 0.45;
      for (const [f0, f1, q, g, p0] of [[3200, 260, 2.2, 1.9, -0.5], [1500, 120, 1.4, 1.4, 0.5]]) {
        const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(), p = pan(p0); s.buffer = noiseBuf; s.loop = true;
        b.type = 'bandpass'; b.Q.value = q; b.frequency.setValueAtTime(f0, ta); b.frequency.exponentialRampToValueAtTime(f1, ta + td);
        if (p.pan) { p.pan.setValueAtTime(p0, ta); p.pan.linearRampToValueAtTime(-p0, ta + td); }
        v.gain.setValueAtTime(0.0001, ta); jag(v, ta, ta + td, 0.012, 0.15, 1, (k) => g * Math.min(1, k * 6) * (1 - k * 0.55)); v.gain.setValueAtTime(0.0001, ta + td + 0.02);
        s.connect(b); b.connect(v); v.connect(p); p.connect(master); s.start(ta, R()); s.stop(ta + td + 0.05);
      } }

    // 6. full open: the pressure slams (a deep push and a crack of the wall's frame), then a low unsteady roar hangs on
    if (on('slam')) { A._thump(open, 44, 2.6, 0.27); A._thump(open + 0.03, 92, 0.5, 0.1); A._body(open, [110, 187, 263, 410], 1.4, 0.3, { q: 22 }); }
    // the roar left hanging after the slam
    if (on('roar')) { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true;
      b.type = 'lowpass'; b.Q.value = 6; b.frequency.setValueAtTime(320, open); b.frequency.exponentialRampToValueAtTime(110, open + 6);
      v.gain.setValueAtTime(0.0001, open); v.gain.exponentialRampToValueAtTime(0.8, open + 0.25);
      jag(v, open + 0.3, open + 5.5, 0.09, 0.4, 1, (k) => 0.8 * (1 - k) ** 1.6); v.gain.setValueAtTime(0.0001, open + 5.6);
      s.connect(b); b.connect(v); v.connect(master); s.start(open, R()); s.stop(open + 5.7); }
  },
  // ---- beings coming through the doorway: ethereal, not physical ----
  // Shared pieces, each sent dry to the master and wet into a long dark reverb (_verb), so everything hangs in the air.
  // _verb(): a 3.4 s reverb made from decaying noise, one per cue. _suck(): a reversed swell, air drawn in towards a
  // moment and cut off at it. _choir(): breathy wordless voices: a slightly unsteady saw plus breath noise through three
  // vowel formants that move from one vowel to another (mouth opening); pitch can sink or climb. _comb(): a noise breath
  // through a tuned feedback delay whose pitch glides, the ringing sweep of the doorway's surface as something passes it.
  // _grains(): a glitter of static, tiny bright noise grains scattered in time and space.
  _verb(wet = 0.5) {
    if (!A._ir || A._ir.sampleRate !== ctx.sampleRate) {
      const n = Math.floor(ctx.sampleRate * 3.4), b = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) { const x = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.6) * (i < 400 ? i / 400 : 1); } }
      A._ir = b;
    }
    const cv = ctx.createConvolver(), lp = ctx.createBiquadFilter(), v = ctx.createGain(); cv.buffer = A._ir; lp.type = 'lowpass'; lp.frequency.value = 3800; v.gain.value = wet;
    cv.connect(lp); lp.connect(v); v.connect(master); return cv;
  },
  _out(pn, dry, verb, wet) {   // a voice's output: panned, dry to master, a share into the reverb
    const g = ctx.createGain(); let o = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); if (Array.isArray(pn)) { p.pan.setValueAtTime(pn[0], pn[2]); p.pan.linearRampToValueAtTime(pn[1], pn[3]); } else p.pan.value = pn; g.connect(p); o = p; }
    const d = ctx.createGain(), w = ctx.createGain(); d.gain.value = dry; w.gain.value = wet; o.connect(d); o.connect(w); d.connect(master); if (verb) w.connect(verb); return g;
  },
  _suck(at, peak, f0, f1, g, pn, verb) {
    const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true;
    b.type = 'bandpass'; b.Q.value = 2.2; b.frequency.setValueAtTime(f0, at); b.frequency.exponentialRampToValueAtTime(f1, peak);
    v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(g, peak); v.gain.setTargetAtTime(0.0001, peak, 0.025);
    s.connect(b); b.connect(v); v.connect(A._out(pn, 0.7, verb, 0.9)); s.start(at, Math.random()); s.stop(peak + 0.4);
  },
  _choir(at, dur, f, g, { from = [300, 870, 2240], to = [730, 1090, 2440], bend = 1, pan = 0, att = 0.35, rel = 0.4, verb = null, wet = 1.1 } = {}) {
    const end = at + dur, out = A._out(pan, 0.55, verb, wet), env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(g, at + dur * att); env.gain.setValueAtTime(g, end - dur * rel); env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(out);
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), og = ctx.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * bend, end);
    lfo.frequency.value = 4.6 + Math.random() * 1.2; lg.gain.value = f * 0.006; lfo.connect(lg); lg.connect(o.frequency); og.gain.value = 0.5;
    const n = ctx.createBufferSource(), ng = ctx.createGain(); n.buffer = noiseBuf; n.loop = true; ng.gain.value = 0.35;
    o.connect(og); n.connect(ng);
    [1, 0.5, 0.22].forEach((w, i) => {
      const bp = ctx.createBiquadFilter(), bg = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 9 - i * 2;
      bp.frequency.setValueAtTime(from[i], at); bp.frequency.exponentialRampToValueAtTime(to[i], at + dur * 0.7);
      bg.gain.value = w * 3; og.connect(bp); ng.connect(bp); bp.connect(bg); bg.connect(env);
    });
    o.start(at); lfo.start(at); n.start(at, Math.random()); o.stop(end + 0.05); lfo.stop(end + 0.05); n.stop(end + 0.05);
  },
  _comb(at, d, f0, f1, g, pn, verb) {
    const s = ctx.createBufferSource(), e = ctx.createGain(), dl = ctx.createDelay(0.1), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true;
    e.gain.setValueAtTime(0.0001, at); e.gain.exponentialRampToValueAtTime(1, at + d * 0.3); e.gain.exponentialRampToValueAtTime(0.0001, at + d * 0.8);
    dl.delayTime.setValueAtTime(1 / f0, at); dl.delayTime.exponentialRampToValueAtTime(1 / f1, at + d);
    fb.gain.value = 0.9; lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = -6;   // Q is in dB here: any resonance in the loop and it runs away
    s.connect(e); e.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl);
    v.gain.setValueAtTime(g, at); v.gain.setValueAtTime(g, at + d * 0.8); v.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.6);
    lp.connect(v); v.connect(A._out(pn, 0.6, verb, 1)); s.start(at, Math.random()); s.stop(at + d + 0.7);
  },
  _grains(at, span, n, g, verb, { lo = 2800, hi = 9000, bias = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const x = at + Math.pow(Math.random(), bias) * span, dd = 0.003 + Math.random() * 0.012;
      const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf;
      b.type = 'bandpass'; b.Q.value = 6; b.frequency.value = lo * Math.pow(hi / lo, Math.random());
      v.gain.setValueAtTime(0.0001, x); v.gain.exponentialRampToValueAtTime(g * (0.3 + Math.random() * 0.7), x + 0.001); v.gain.exponentialRampToValueAtTime(0.0001, x + dd);
      s.connect(b); b.connect(v); v.connect(A._out(Math.random() * 1.6 - 0.8, 0.5, verb, 1.4)); s.start(x, Math.random() * 1.5); s.stop(x + dd + 0.02);
    }
  },
  // The two greys walking in through the doorway. Called as the doorway finishes opening: lead = seconds until they pass
  // through it (night.js: 2.0 s wait since build 130, then they cross the wall plane about 0.56 s into their walk), walk = their walk
  // (6 s; they end either side of the bed, the one at -x on your right).
  greysIn(lead = 2.56, walk = 6) {
    // Build 129: the doorway's roar, building as they come and cut dead the moment they cross the wall plane
    // (lead seconds after the call). The build 125 version (in-drawn swell, ringing sweep, pressure) is kept in
    // docs/spare-sounds/pass-candidates.js. walk is unused now.
    A.passWall(lead);
  },
  // The tall mantis stooping through the doorway and straightening in the room: d = the stoop-through (night.js 3.2 s:
  // head through at about 0.27 d, body through at 0.54 d, upright by 0.58 d), side = the step along the wall after it.
  mantisIn(d = 3.2, side = 1.6) {
    // Build 129: the same roar, cut dead as the mantis's body comes through the doorway (0.54 d into the stoop).
    // The build 125 version is kept in docs/spare-sounds/pass-candidates.js. side is unused now.
    A.passWall(0.54 * d);
  },
  // ---- passing through the bedroom wall into the doorway's light ----
  // The doorway's roar right in your face, louder as you near the wall, then cut dead as you reach it; in the bedroom the
  // room's drones are silenced at the same moment (night.js). lead = seconds from the call to reaching the wall (night.js
  // calls it as the drift to the wall starts; the view is fully white 3.3 s later, as the eye reaches the wall plane).
  // Build 127: candidate D ('sudden silence') of four build 126 candidates, with the ear ringing and the two heartbeats
  // after the cut removed. All four originals are kept, unchanged, in docs/spare-sounds/pass-candidates.js. No noise
  // sweeps here.
  passWall(lead = 3.3) {
    if (!ctx) return;
    lead = sp(lead);
    const t = ctx.currentTime + 0.02, x = t + lead, s0 = Math.max(t, x - 2.6);
    const drive = ctx.createWaveShaper(); { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const q = i / (n - 1) * 2 - 1; c[i] = Math.tanh(3 * q); } drive.curve = c; }
    // the doorway's roar right in front of you: low saws a tritone apart, driven, opening up, cut dead at the wall
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.setValueAtTime(90, s0); lp.frequency.exponentialRampToValueAtTime(700, x);
      v.gain.setValueAtTime(0.0001, s0); v.gain.exponentialRampToValueAtTime(0.14, x); v.gain.linearRampToValueAtTime(0.0001, x + 0.03);
      for (const [f, w] of [[36, 1], [38.2, 0.8], [51, 0.55]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.95, s0); o.frequency.exponentialRampToValueAtTime(f * 1.05, x); g.gain.value = w * 0.5; o.connect(g); g.connect(drive); o.start(s0); o.stop(x + 0.1); }
      drive.connect(lp); lp.connect(v); v.connect(master); }
    // a heavy hum under it, felt more than heard, cut at the same instant
    { const v = ctx.createGain(); v.gain.setValueAtTime(0.0001, s0); v.gain.exponentialRampToValueAtTime(0.1, x); v.gain.linearRampToValueAtTime(0.0001, x + 0.03);
      for (const [f, ty] of [[55, 'sine'], [110.3, 'triangle']]) { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f; o.connect(v); o.start(s0); o.stop(x + 0.1); }
      v.connect(master); }
  },
  chime(f = 660) { A.tone(f, 1.2, { g: 0.12 }); A.tone(f * 1.5, 1.4, { g: 0.07 }); },
  crinkle() { for (let i = 0; i < 14; i++) setTimeout(() => A.noise(0.05, { g: 0.2, f: 2500 + Math.random() * 4000, q: 4 }), i * 60 + Math.random() * 40); },
  // ==== control room cues (js/scenes/control.js) ====
  // The hall at work, until stopped: a low hum that breathes, the loom's threads singing thinly overhead, and small relays
  // letting go at the consoles. Returns { set(level), stop(sec) }.
  ctrlRoom(level = 1) {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.02, bus = ctx.createGain(), srcs = []; let alive = true;
    bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), t + sp(2.5)); bus.connect(master);
    // the hall's own hum: low saws a hair apart behind a low-pass, slowly breathing
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 0.7; v.gain.value = 0.11;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 0.03; lfo.connect(lg); lg.connect(v.gain); lfo.start(t); srcs.push(lfo);
      for (const f of [46.2, 46.9, 69.4, 92.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); srcs.push(o); }
      lp.connect(v); v.connect(bus); }
    // the loom: threads singing, thin high bands that swell and fade against one another
    { const v = ctx.createGain(); v.gain.value = 3.6; v.connect(bus);
      [[1244, -0.5], [1397, 0.4], [1661, -0.2], [2093, 0.6]].forEach(([f, pan], i) => {
        const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 240; g.gain.value = 0.55;
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07 + i * 0.045; lg.gain.value = 0.4; lfo.connect(lg); lg.connect(g.gain); lfo.start(t); srcs.push(lfo);
        let o = g; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); o = p; }
        s.connect(b); b.connect(g); o.connect(v); s.start(t, Math.random()); srcs.push(s); }); }
    // the consoles: small relays letting go, never in time with one another
    const relays = (from, span) => { for (let i = 0, n = Math.round(span * 2.4); i < n; i++) A._body(from + Math.random() * span, [1700 + Math.random() * 1500, 3600 + Math.random() * 1500], 0.06, 0.085, { q: 30, strike: 0.001, dest: bus }); };
    relays(t + 0.3, 6);
    const more = () => { if (!alive) return; relays(ctx.currentTime + 0.2, 6); timer = setTimeout(more, 6000); }; let timer = setTimeout(more, 6000);
    const h = {
      set(l, sec = 1) { const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(Math.max(l, 0.0001), n, sp(sec) / 3); },
      stop(sec = 1) { if (!alive) return; alive = false; clearTimeout(timer); live.delete(h); const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4); for (const s of srcs) try { s.stop(n + sec + 0.2); } catch (_) {} setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (sec + 0.5) * 1000); },
    };
    live.add(h);
    return h;
  },
  // What a bead's little world sounds like when it is brought close: 'home' (an engine ticking over, gravel), 'cold' (night
  // air, and the trilling tones from the small speaker), 'rain' (rain on car roofs), 'gold' (fog: a held hush, and a far
  // beating tone). Silent until set: returns { set(level 0..1), stop(sec) }.
  beadWorld(kind = 'cold', level = 0) {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.02, bus = ctx.createGain(), srcs = []; let alive = true, last = -1;
    bus.gain.value = Math.max(level, 0.0001); bus.connect(master);
    const home = kind === 'home', cold = kind === 'cold', wet = kind === 'rain', gold = kind === 'gold';
    // (helpers: a band of noise, a tone, a slow wobble on a level or pitch; each is started by the layer that uses it)
    const band = (fr, q, g, pan = 0) => { const n = ctx.createBufferSource(), bq = ctx.createBiquadFilter(), v = ctx.createGain(); n.buffer = noiseBuf; n.loop = true; bq.type = 'bandpass'; bq.frequency.value = fr; bq.Q.value = q; v.gain.value = g;
      let o = v; if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; v.connect(p); o = p; }
      n.connect(bq); bq.connect(v); o.connect(bus); srcs.push(n); return { n, v }; };
    const osc = (fr, type, g, dest) => { const o = ctx.createOscillator(), v = ctx.createGain(); o.type = type; o.frequency.value = fr; v.gain.value = g; o.connect(v); v.connect(dest); srcs.push(o); return o; };
    const wob = (param, rate, depth) => { const l = ctx.createOscillator(), g = ctx.createGain(); l.frequency.value = rate; g.gain.value = depth; l.connect(g); g.connect(param); srcs.push(l); return l; };
    const low = (cut, g) => { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = cut; v.gain.value = g; lp.connect(v); v.connect(bus); return { lp, v }; };
    // home: the engine ticking over, a low lumpy idle
    if (home) { const e = low(260, 0.1); osc(41, 'sawtooth', 1, e.lp).start(t); osc(61.7, 'square', 0.4, e.lp).start(t); wob(e.v.gain, 13.7, 0.035).start(t); wob(e.v.gain, 0.4, 0.02).start(t); }
    // home: tyres turning on gravel, a dry crackling band
    if (home) { const c = band(2300, 0.8, 0.1); c.n.start(t, Math.random()); wob(c.v.gain, 7.3, 0.06).start(t); wob(c.v.gain, 17.9, 0.03).start(t); }
    // home: the cabin's dull thrum
    if (home) band(120, 3, 0.8).n.start(t, Math.random());
    // cold: night air over the field, low and wide
    if (cold) { band(330, 0.5, 0.14, -0.4).n.start(t, Math.random()); band(410, 0.5, 0.14, 0.4).n.start(t, Math.random()); }
    // cold: the small speaker's trilling tones, thin and boxy
    if (cold) { const bp = ctx.createBiquadFilter(), v = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 5000; bp.Q.value = 4; v.gain.value = 0.045; bp.connect(v); v.connect(bus);
      const o = osc(5050, 'triangle', 1, bp); o.start(t); wob(o.frequency, 31, 420).start(t); wob(o.frequency, 0.31, 160).start(t); wob(v.gain, 23, 0.03).start(t); wob(v.gain, 0.23, 0.012).start(t); }
    // cold: hedge and grass stirring
    if (cold) { const c = band(5200, 1.2, 0.03); c.n.start(t, Math.random()); wob(c.v.gain, 0.17, 0.018).start(t); }
    // rain: on the car roofs, a hard bright patter
    if (wet) { const c = band(3400, 0.7, 0.09); c.n.start(t, Math.random()); wob(c.v.gain, 9.1, 0.03).start(t); }
    // rain: on the grass, softer and lower
    if (wet) band(900, 0.6, 0.1).n.start(t, Math.random());
    // rain: the roofs drumming under it
    if (wet) { const c = band(210, 4, 0.45); c.n.start(t, Math.random()); wob(c.v.gain, 5.3, 0.15).start(t); }
    // gold: the fog, a close hush
    if (gold) band(260, 0.6, 0.3).n.start(t, Math.random());
    // gold: something standing over the field, two low tones beating slowly
    if (gold) { const e = low(420, 0.07); osc(98, 'triangle', 1, e.lp).start(t); osc(98.7, 'triangle', 1, e.lp).start(t); osc(147.2, 'sawtooth', 0.25, e.lp).start(t); }
    // gold: very high, a thin ringing
    if (gold) { band(5600, 60, 0.9, -0.3).n.start(t, Math.random()); band(5730, 60, 0.9, 0.3).n.start(t, Math.random()); }
    // (the handle)
    const h = {
      set(l) { l = Math.max(0, Math.min(1, l)); if (Math.abs(l - last) < 0.015) return; last = l; bus.gain.setTargetAtTime(Math.max(l, 0.0001), ctx.currentTime, 0.12); },
      stop(sec = 0.6) { if (!alive) return; alive = false; live.delete(h); const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4); for (const x of srcs) try { x.stop(n + sec + 0.2); } catch (_) {} setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (sec + 0.5) * 1000); },
    };
    live.add(h);
    return h;
  },
  // One of the loom's threads let go by a hook (i 0..6 picks its note): a taut string sounding, its upper partials, and the
  // dry tick of the hook leaving it.
  loomPluck(i = 0) {
    if (!ctx || paced('loomPluck', 2) || crowded()) return;
    const t = ctx.currentTime + 0.02, f = [196, 220, 261.6, 293.7, 329.6, 392, 440][((i % 7) + 7) % 7];
    // the string
    A._body(t, [f, f * 2.003], 1.9, 0.12, { q: 420, strike: 0.003 });
    // its upper partials
    A._body(t, [f * 3.01, f * 4.03, f * 5.06], 0.9, 0.09, { q: 300, strike: 0.002 });
    // the hook leaving it
    A._body(t, [2900, 4700], 0.035, 0.1, { q: 18, strike: 0.001 });
  },
  // The chosen thread drawn tight: three short rubbed creaks as it takes the strain, the deep note of it coming taut, and
  // a bright ring that blooms and stays as it turns to gold.
  loomTie() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the strain: fibres creaking as they take it up
    [[0, 311], [0.42, 370], [0.8, 440]].forEach(([d, f]) => A._body(t + d, [f, f * 2.41], 0.28, 0.11, { q: 70, swell: 0.16 }));
    // taut: the low note of the whole thread
    A._thump(t + 1.3, 74, 0.7, 0.1);
    A._body(t + 1.3, [110, 220.4, 331], 3.6, 0.07, { q: 320, strike: 0.004 });
    // gold: a ring that blooms out of it and holds
    A._body(t + 1.45, [880, 1320.5, 1761, 2643], 4.2, 0.03, { q: 420, swell: 1.3 });
    // light running along it
    A._glints(t + 1.5, 2.4, 22, 2000, 7000, 0.016, 0.9, 0.02, 1.4);
  },
  // A thread fraying and its bead's world going out (i picks its note): fibres parting in a run of dry cracks, the
  // thread's own note sagging out, a dull low stop.
  loomFray(i = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02, f = [196, 220, 261.6, 293.7, 329.6, 392, 440][((i % 7) + 7) % 7];
    // fibres parting
    for (let k = 0; k < 14; k++) A._body(t + Math.pow(k / 14, 1.6) * 1.3 + Math.random() * 0.03, [1500 + Math.random() * 2500, 5200 + Math.random() * 2000], 0.03, 0.045 * (1 - k / 20), { q: 14, strike: 0.001 });
    // the thread's note, slack now and dull
    A._body(t + 0.05, [f * 0.5, f * 0.752], 0.8, 0.13, { q: 60, strike: 0.006 });
    // the window going dark
    A._thump(t + 0.95, 58, 0.5, 0.09);
  },
  // A dark bead falling into the basin: a small wet knock and a soft bloom under it.
  basinDrop() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the knock
    A._body(t, [540, 1090, 1720], 0.28, 0.075, { q: 55, strike: 0.002 });
    // the basin taking it
    A._thump(t + 0.01, 96, 0.4, 0.07);
    // light scattering where it went in
    A._glints(t + 0.03, 0.5, 7, 1800, 5200, 0.014, 0.5, 0, 1.6);
  },
  // A pad on the weather table pressed home (i 0..3, each seated a little lower): the key's heavy seat, the body of the
  // table answering, the latch.
  padPress(i = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02, k = 1 - i * 0.06;
    // the key seating
    A._thump(t, 66 * k, 0.32, 0.2);
    // the table answering
    A._body(t + 0.004, [148 * k, 221 * k, 347 * k], 1.1, 0.3, { q: 90, strike: 0.005 });
    // the latch
    A._body(t + 0.03, [1850, 3050], 0.045, 0.14, { q: 22, strike: 0.001 });
  },
  // The amber dome rolled under a palm: a heavy ball turning in its seat, detents ticking past, a hum from under it.
  domeRoll(d = 2.8) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the ball turning in its seat
    { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = 105; b.Q.value = 1.4;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.5, t + 0.35); v.gain.setValueAtTime(0.5, t + d - 0.5); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 3.1; lg.gain.value = 0.18; l.connect(lg); lg.connect(v.gain); l.start(t); l.stop(t + d + 0.1);
      s.connect(b); b.connect(v); v.connect(master); s.start(t, Math.random()); s.stop(t + d + 0.1); }
    // detents ticking past
    for (let i = 0; i < 15; i++) A._body(t + 0.2 + (i / 15) * (d - 0.5) + Math.random() * 0.04, [760, 1180, 2300], 0.05, 0.035, { q: 28, strike: 0.001 });
    // a hum from under it
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 300; v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.035, t + 0.5); v.gain.setValueAtTime(0.035, t + d - 0.4); v.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
      for (const f of [73.4, 110.4]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + d + 0.4); }
      lp.connect(v); v.connect(master); }
  },
  // The table at work after a pad (n 0..3: cloud, mist, rain, the fog closing): a hum coming up under it and holding, a
  // held resonance, glass ticking as it works.
  tableStir(n = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02, f = [61.7, 55, 73.4, 49][((n % 4) + 4) % 4], d = 4.5;
    // the hum under the table
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.8;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.06, t + 0.9); v.gain.setValueAtTime(0.06, t + d - 1.6); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      for (const [m, ty] of [[1, 'sawtooth'], [1.008, 'sawtooth'], [2.01, 'square']]) { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f * m; o.connect(lp); o.start(t); o.stop(t + d + 0.1); }
      lp.connect(v); v.connect(master); }
    // a held resonance in the table's rim
    A._body(t + 0.3, [f * 4, f * 6.02, f * 9.05], 3.2, 0.035, { q: 200, swell: 1.4 });
    // glass ticking as it works
    A._glints(t + 0.5, 3.2, 9, 1400, 4200, 0.022, 0.35, 0, 1.2);
  },
  // The ring over the couch coming down: its hum, two tones a few cycles apart, and a thin hard edge. Returns
  // { set(level 0..1), stop(sec) }; silent until set.
  linkRing(level = 0) {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.02, bus = ctx.createGain(), srcs = []; let alive = true, last = -1;
    bus.gain.value = Math.max(level, 0.0001); bus.connect(master);
    // the hum: two tones beating
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 520; v.gain.value = 0.11; lp.connect(v); v.connect(bus);
      for (const [f, ty] of [[124, 'triangle'], [127.4, 'triangle'], [248.6, 'sawtooth']]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = ty; o.frequency.value = f; g.gain.value = ty === 'sawtooth' ? 0.3 : 1; o.connect(g); g.connect(lp); o.start(t); srcs.push(o); } }
    // the ring's edge: a thin hard band either side of the head
    for (const [f, pan] of [[3120, -0.7], [3190, 0.7]]) { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 90; v.gain.value = 1.4;
      let o = v; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; v.connect(p); o = p; }
      s.connect(b); b.connect(v); o.connect(bus); s.start(t, Math.random()); srcs.push(s); }
    const h = {
      set(l) { l = Math.max(0, Math.min(1, l)); if (Math.abs(l - last) < 0.015) return; last = l; bus.gain.setTargetAtTime(Math.max(l * l, 0.0001), ctx.currentTime, 0.12); },
      stop(sec = 0.6) { if (!alive) return; alive = false; live.delete(h); const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4); for (const s of srcs) try { s.stop(n + sec + 0.2); } catch (_) {} setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (sec + 0.5) * 1000); },
    };
    live.add(h);
    return h;
  },
  // The ring closing round your head: a magnetic seat, pressure in the ears, and the ears ringing a hair apart.
  linkLock() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the ring seating
    A._thump(t, 84, 0.3, 0.3);
    A._body(t, [176, 263, 412], 0.7, 0.05, { q: 80, strike: 0.004 });
    // pressure
    A._thump(t + 0.15, 37, 2.6, 0.24);
    // the ears ringing
    A._air(t + 0.2, 3.0, 5900, 5900, 45, 1.1, { atk: 0.25, pan: -0.2 });
    A._air(t + 0.2, 3.0, 6040, 6040, 45, 1.1, { atk: 0.25, pan: 0.2 });
  },
  // One key pressed at a console somewhere in the hall (k 0..1: how near): a small dull tap and its click.
  consoleTick(k = 1) {
    if (!ctx || k <= 0 || paced('consoleTick', 2) || crowded()) return;
    const t = ctx.currentTime + 0.02;
    // the key bottoming
    A._thump(t, 190, 0.05, 0.1 * k);
    // its click
    A._body(t, [1500 + Math.random() * 500, 2700 + Math.random() * 600], 0.03, 0.06 * k, { q: 20, strike: 0.001 });
  },
  // The lever on the weather table leaned over for d seconds against a slow, fluid resistance: a thick low groan from
  // under the table, the shaft creaking in its boot now and then, a faint hum while it is held over.
  leverPush(d = 4) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the resistance: a thick low groan, steady while it goes
    { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = 150; b.Q.value = 5;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.9, t + 0.4); v.gain.setValueAtTime(0.9, t + d * 0.8); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2; lg.gain.value = 0.3; l.connect(lg); lg.connect(v.gain); l.start(t); l.stop(t + d + 0.1);
      s.connect(b); b.connect(v); v.connect(master); s.start(t, Math.random()); s.stop(t + d + 0.1); }
    // the shaft creaking in its boot
    for (let i = 0; i < 5; i++) { const f = 240 + Math.random() * 90; A._body(t + 0.3 + (i / 5) * (d - 0.8) + Math.random() * 0.15, [f, f * 2.37], 0.22, 0.09, { q: 60, swell: 0.12 }); }
    // a hum while it is held over
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 260; v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.05, t + d * 0.5); v.gain.setValueAtTime(0.05, t + d * 0.85); v.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
      for (const f of [65.4, 98.3]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + d + 0.3); }
      lp.connect(v); v.connect(master); }
  },
  // The lever let go: it springs upright against its stop, and rattles there a moment.
  leverBack() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the stop
    A._thump(t + 0.06, 120, 0.16, 0.2);
    // the shaft ringing
    A._body(t + 0.06, [310, 742, 1190], 0.5, 0.12, { q: 110, strike: 0.003 });
    // the grip rattling to rest
    for (let i = 0; i < 4; i++) A._body(t + 0.16 + i * 0.075, [1400, 2300], 0.03, 0.09 * (1 - i * 0.2), { q: 20, strike: 0.001 });
  },
  // The crossroads turning into the control room around you: the ship's structure takes up a deep hum, the round room rings
  // with it on its own two tones, the wall panels tremble against their frames and the floor throbs, until the hall is
  // there. It carries over the change of scene: it is not in `live` (the scene change's stopAll would end it), so whoever
  // starts it stops it, and it ends itself after 40 s if nobody does. Rises to `level` over 1.8 s; returns { set(level,
  // sec), stop(sec) }.
  shiftHum(level = 1) {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.02, bus = ctx.createGain(), srcs = []; let alive = true;
    bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), t + sp(1.8)); bus.connect(master);
    // (helpers, each started by the layer that uses it: a slow or fast wobble on a level; a band of looping noise)
    const wob = (param, rate, depth) => { const l = ctx.createOscillator(), g = ctx.createGain(); l.frequency.value = rate; g.gain.value = depth; l.connect(g); g.connect(param); srcs.push(l); return l; };
    const noiseBand = (f, q, g, dest) => { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; v.gain.value = g; s.connect(b); b.connect(v); v.connect(dest); srcs.push(s); return { s, v }; };
    // the structure: a deep hum in the hull, low saws a fifth apart and a hair out of tune, beating slowly, under a low-pass
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 150; lp.Q.value = 0.9; v.gain.value = 0.2;
      for (const f of [37, 37.35, 55.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); srcs.push(o); }
      wob(v.gain, 0.55, 0.05).start(t); lp.connect(v); v.connect(bus); }
    // the room answering on its own two tones (the crossroads' 74 and 111.3 Hz) and their octave: rings of filtered noise,
    // narrow enough to sing, swelling against one another
    { const v = ctx.createGain(); v.gain.value = 1; v.connect(bus);
      [[74, 0.9, 0.31], [111.3, 0.75, 0.43], [148.4, 0.45, 0.23]].forEach(([f, g, r]) => { const b = noiseBand(f, 70, g * 9, v); b.s.start(t, Math.random() * 1.5); wob(b.v.gain, r, g * 4).start(t); });
      for (const [f, g] of [[74, 0.025], [111.3, 0.018]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(v); o.start(t); srcs.push(o); } }
    // the wall panels trembling in their frames: mid bands of noise shaken at 19 and 23 Hz, a metal buzz
    { const v = ctx.createGain(); v.gain.value = 1; v.connect(bus);
      const a = noiseBand(430, 2.5, 0.5, v), b = noiseBand(930, 3.5, 0.32, v);
      a.s.start(t, Math.random() * 1.5); b.s.start(t, Math.random() * 1.5); wob(a.v.gain, 19, 0.45).start(t); wob(b.v.gain, 23.3, 0.3).start(t); }
    // the floor throbbing: a low tone that swells and sinks a little faster than once a second
    { const o = ctx.createOscillator(), v = ctx.createGain(); o.frequency.value = 46; v.gain.value = 0.07; o.connect(v); v.connect(bus); o.start(t); srcs.push(o); wob(v.gain, 1.15, 0.065).start(t); }
    const h = {
      set(l, sec = 1) { if (!alive) return; const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(Math.max(l, 0.0001), n, sp(sec) / 3); },
      stop(sec = 1) { if (!alive) return; alive = false; clearTimeout(timer); const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4); for (const s of srcs) try { s.stop(n + sec + 0.2); } catch (_) {} setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (sec + 0.5) * 1000); },
    };
    const timer = setTimeout(() => h.stop(2), 40000);
    return h;
  },
  // ==== end control room cues ====
  // ==== field cues (js/scenes/field.js) ====
  // Field helpers. _fband: a band of noise that stays where it is (never glides), behind its own gain, which starts silent
  // so a cue can shape it; returns { src, gain }. _floop: a handle for a looping cue, registered in live so stopAll ends it;
  // run(from, to) schedules the cue's events in that stretch, and the loop keeps scheduling ahead while it lives.
  _fband(f, q, g, pan, dest) {
    const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), gg = ctx.createGain(), v = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; gg.gain.value = g; v.gain.value = 0.0001;
    let o = v; if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; v.connect(p); o = p; }
    s.connect(b); b.connect(gg); gg.connect(v); o.connect(dest || master); s.start(ctx.currentTime, Math.random() * 1.5);
    return { src: s, gain: v.gain };
  },
  // The schedule is kept a fixed stretch ahead of the audio clock, never of the wall clock: while the context is suspended
  // (the pause menu) its clock stands still, so nothing more is queued, and no backlog of future nodes builds up.
  _floop(srcs, bus, run, set) {
    const t = ctx.currentTime;
    let next = t + 20, alive = true;
    run(t + 0.05, next);
    const timer = setInterval(() => { if (!alive) return; while (next < ctx.currentTime + 15) { run(next, next + 10); next += 10; } }, 2000);
    const h = {
      set,
      // silence it at once (no fade); a later set() brings it back
      cut() { if (!alive) return; const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setValueAtTime(0.0001, n); },
      stop(sec = 1) {
        if (!alive) return; alive = false; clearInterval(timer);
        const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4);
        for (const s of srcs) { try { s.stop(n + sec + 0.2); } catch (_) {} }
        setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (sec + 0.5) * 1000);   // anything still queued on it is no longer pulled
        live.delete(h);
      },
    };
    live.add(h); return h;
  },
  // One bark from a dog across the valley: a voiced yelp through two mouth formants, dulled by distance, and its echo
  // coming back off the hills twice.
  _fbark(at, dest, g = 1) {
    const o = ctx.createOscillator(), m1 = ctx.createBiquadFilter(), m2 = ctx.createBiquadFilter(), v = ctx.createGain(), lp = ctx.createBiquadFilter(), f0 = 300 + Math.random() * 80;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 0.75, at); o.frequency.exponentialRampToValueAtTime(f0, at + 0.035); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, at + 0.17);
    m1.type = 'bandpass'; m1.frequency.value = 850; m1.Q.value = 3; m2.type = 'bandpass'; m2.frequency.value = 1700; m2.Q.value = 4; lp.type = 'lowpass'; lp.frequency.value = 1400;
    v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.9 * g, at + 0.012); v.gain.exponentialRampToValueAtTime(0.0001, at + 0.21);
    o.connect(m1); o.connect(m2); m1.connect(v); m2.connect(v); v.connect(lp); lp.connect(dest);
    const e1 = ctx.createDelay(2), l1 = ctx.createBiquadFilter(), g1 = ctx.createGain(), e2 = ctx.createDelay(3), g2 = ctx.createGain();
    e1.delayTime.value = 0.62; l1.type = 'lowpass'; l1.frequency.value = 800; g1.gain.value = 0.3; e2.delayTime.value = 1.45; g2.gain.value = 0.12;
    lp.connect(e1); e1.connect(l1); l1.connect(g1); g1.connect(dest); l1.connect(e2); e2.connect(g2); g2.connect(dest);
    o.start(at); o.stop(at + 0.25);
  },
  // The night in an open field, a loop: wind over rough grass and through a bare hedge, the grass itself hissing with each
  // gust, a dog far off with the hills answering, and a cooling exhaust ticking on one of the cars. Every band stays at its
  // pitch; only its loudness moves. set(level, damp): damp 0..1 is the fog closing round you (the highs go first).
  fieldNight() {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.05, R = Math.random, srcs = [], more = [], bus = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 14000; bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(1, t + 2.5); bus.connect(lp); lp.connect(master);
    const gust = (gn, len, from, to, depth) => { for (let at = from; at < to;) { const d = len * (0.6 + R() * 0.9); gn.setTargetAtTime(Math.max(0.0001, 1 - depth + depth * (0.15 + R() * 1.1)), at, d * 0.35); at += d; } };
    // wind: a broad low roar of moving air over the field, and a narrower band where it combs through the hedge
    { const a = A._fband(300, 0.6, 0.35, -0.2, bus), b = A._fband(760, 1.3, 0.21, 0.3, bus); srcs.push(a.src, b.src);
      more.push((from, to) => { gust(a.gain, 4.5, from, to, 0.75); gust(b.gain, 3.2, from, to, 0.85); }); }
    // grass: the dry hiss of tussocks and dead stems, rising and falling with the wind
    { const a = A._fband(5200, 0.9, 0.12, 0.5, bus), b = A._fband(3100, 1.6, 0.1, -0.5, bus); srcs.push(a.src, b.src);
      more.push((from, to) => { gust(a.gain, 3.0, from, to, 0.9); gust(b.gain, 2.4, from, to, 0.9); }); }
    // a dog far off across the valley, its bark coming back off the hills
    { more.push((from, to) => { for (let at = from + 1.5 + R() * 3; at < to; at += 12 + R() * 16) { const n = 1 + Math.floor(R() * 3); for (let i = 0; i < n; i++) A._fbark(at + i * (0.42 + R() * 0.2), bus, 0.35 + R() * 0.15); } }); }
    // the cars: a cooling exhaust ticking now and then, thin metal
    { more.push((from, to) => { for (let at = from + R(); at < to; at += 0.9 + R() * 4) A._body(at, [3400 + R() * 900, 6100 + R() * 800], 0.05, 0.016, { q: 60, dest: bus }); }); }
    // (scheduling)
    return A._floop(srcs, bus, (from, to) => { for (const f of more) f(from, to); }, (level = 1, damp = 0) => {
      const n = ctx.currentTime; bus.gain.setTargetAtTime(Math.max(0.0001, level), n, 0.6); lp.frequency.setTargetAtTime(14000 * Math.pow(0.08, damp), n, 0.8);
    });
  },
  // The "crop circle tones" playing from a phone through a small round speaker on the camp table: a fast pulsing trill near
  // 5 kHz that warbles, in phrases with short gaps, the second voice of the recording chirping slower and lower under it,
  // the little cabinet knocking at each phrase, and the cheap amplifier's hiss. Small and tinny in a big open field.
  // set(level, pan): how near the speaker is and where.
  cropTones() {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.05, R = Math.random, srcs = [], more = [];
    const spk = ctx.createGain(), sh = ctx.createWaveShaper(), hp = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), bus = ctx.createGain();
    { const n = 512, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); } sh.curve = c; }
    hp.type = 'highpass'; hp.frequency.value = 650; hp.Q.value = 0.9; pk.type = 'peaking'; pk.frequency.value = 2800; pk.Q.value = 2; pk.gain.value = 7; lp.type = 'lowpass'; lp.frequency.value = 7500;
    bus.gain.value = 0.5; spk.connect(sh); sh.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(bus);
    let out = bus; const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pan) { bus.connect(pan); out = pan; } out.connect(master);
    const phrases = (from, to) => { const L = []; for (let at = from; at < to;) { const on = 1.1 + R() * 1.4; L.push([at, on, R() < 0.3]); at += on + 0.25 + R() * 0.6; } return L; };
    // the trill: a tone near 5 kHz pulsed fifteen times a second and warbling, phrase after phrase (the main voice)
    { const o = ctx.createOscillator(), w = ctx.createOscillator(), wg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), gate = ctx.createGain(), env = ctx.createGain();
      o.frequency.value = 5050; w.frequency.value = 9; wg.gain.value = 70; w.connect(wg); wg.connect(o.frequency);
      lfo.type = 'square'; lfo.frequency.value = 15.5; lg.gain.value = 0.5; gate.gain.value = 0.5; lfo.connect(lg); lg.connect(gate.gain);
      env.gain.value = 0.0001; o.connect(gate); gate.connect(env); env.connect(spk); o.start(t); w.start(t); lfo.start(t); srcs.push(o, w, lfo);
      more.push((L) => { for (const [at, on, lo] of L) { env.gain.setTargetAtTime(0.5, at, 0.008); o.frequency.setTargetAtTime(lo ? 4350 : 5000 + R() * 160, at, 0.015); env.gain.setTargetAtTime(0.0001, at + on, 0.012); } }); }
    // the second voice: a slower, lower chirp, like a cricket close by, answering in the gaps
    { const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), gate = ctx.createGain(), env = ctx.createGain();
      o.frequency.value = 3650; lfo.type = 'square'; lfo.frequency.value = 7.7; lg.gain.value = 0.5; gate.gain.value = 0.5; lfo.connect(lg); lg.connect(gate.gain);
      env.gain.value = 0.0001; o.connect(gate); gate.connect(env); env.connect(spk); o.start(t); lfo.start(t); srcs.push(o, lfo);
      more.push((L) => { for (const [at, on] of L) { env.gain.setTargetAtTime(0.22, at + on * 0.45, 0.01); env.gain.setTargetAtTime(0.0001, at + on + 0.2, 0.02); } }); }
    // the cabinet: the little plastic drum knocking as each phrase starts
    { more.push((L) => { for (const [at] of L) A._body(at, [620, 1340, 2210], 0.07, 0.2, { q: 25, dest: spk }); }); }
    // amplifier hiss: the cheap speaker's noise floor, close up
    { const h = A._fband(6800, 0.8, 0.14, 0, spk); h.gain.setValueAtTime(1, t); srcs.push(h.src); }
    // (scheduling)
    return A._floop(srcs, bus, (from, to) => { const L = phrases(from, to); for (const f of more) f(L); }, (level = 1, p = 0) => {
      const n = ctx.currentTime; bus.gain.setTargetAtTime(Math.max(0.0001, 0.5 * level), n, 0.25); if (pan) pan.pan.setTargetAtTime(p, n, 0.25);
    });
  },
  // The mantis's own breathing, heard from inside its body: slow and deep through a long hollow chest (in through a higher
  // band, out through a lower one; the bands stay put, the breath is in the loudness), a dry rasp catching on each out-breath,
  // and now and then a double click of mouthparts in the hollow head. set(level).
  mantisBreath() {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.05, R = Math.random, srcs = [], more = [], bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);
    const cycles = (from, to) => { const L = []; for (let at = from + 0.3; at < to;) { const i = 2.1 + R() * 0.6, x = 2.8 + R() * 0.8; L.push([at, i, x]); at += i + x + 0.8 + R() * 1.2; } return L; };
    // the in-breath: air drawn slowly into a long hollow body
    { const a = A._fband(560, 1.2, 0.5, 0, bus), b = A._fband(1250, 2.5, 0.22, 0, bus); srcs.push(a.src, b.src);
      more.push((L) => { for (const [at, i] of L) for (const gn of [a.gain, b.gain]) { gn.setTargetAtTime(1, at, i * 0.3); gn.setTargetAtTime(0.0001, at + i * 0.8, 0.1); } }); }
    // the out-breath: lower, longer, heavier
    { const a = A._fband(330, 1.0, 0.65, 0, bus), b = A._fband(760, 2.2, 0.25, 0, bus); srcs.push(a.src, b.src);
      more.push((L) => { for (const [at, i, x] of L) for (const gn of [a.gain, b.gain]) { gn.setTargetAtTime(1, at + i + 0.05, 0.25); gn.setTargetAtTime(0.0001, at + i + x * 0.45, x * 0.22); } }); }
    // the rasp: a dry catch high in the throat on each out-breath
    { const a = A._fband(2300, 7, 0.4, 0, bus); srcs.push(a.src);
      more.push((L) => { for (const [at, i, x] of L) { a.gain.setTargetAtTime(0.7, at + i + 0.3, 0.2); a.gain.setTargetAtTime(0.0001, at + i + x * 0.4, 0.3); } }); }
    // clicks: mouthparts and plates in the hollow head, a dry double tick
    { more.push((from, to) => { for (let at = from + 2 + R() * 3; at < to; at += 3 + R() * 6) { A._body(at, [1850, 2950, 4100], 0.07, 0.04, { q: 50, dest: bus }); A._body(at + 0.07 + R() * 0.03, [1700, 2800, 3900], 0.06, 0.03, { q: 50, dest: bus }); } }); }
    // (scheduling)
    return A._floop(srcs, bus, (from, to) => { const L = cycles(from, to); for (const f of more) f.length === 1 ? f(L) : f(from, to); }, (level = 1) => {
      bus.gain.setTargetAtTime(Math.max(0.0001, level), ctx.currentTime, 0.4);
    });
  },
  // One footfall of the tall one on wet grass: the weight of a long leg coming down into the turf, stems crushed under a
  // narrow foot, the hard tip of the foot meeting the ground.
  fieldStep(k = 1, side = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.01, R = Math.random, p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = side * 0.2; p.connect(master);
    // weight: a soft deep push into the turf
    A._thump(t, 50 + R() * 8, 0.34, 0.2 * k);
    // grass: stems crushed, a dense dry crackle
    for (let i = 0; i < 14; i++) { const at = t + i * 0.014 + R() * 0.012, s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf;
      b.type = 'bandpass'; b.frequency.value = 1800 + R() * 3500; b.Q.value = 2.2; v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.9 * k * (1 - i / 18), at + 0.003); v.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      s.connect(b); b.connect(v); v.connect(p); s.start(at, R() * 1.5); s.stop(at + 0.05); }
    // the foot: a hard chitin tip meeting the ground
    A._body(t + 0.004, [760, 1900], 0.05, 0.5 * k, { q: 30, dest: p });
    setTimeout(() => { try { p.disconnect(); } catch (_) {} }, 1500);
  },
  // The felt pressure of the lights, a loop: two deep tones a few hertz apart beating slowly, felt in the chest more than
  // heard; a still, low fullness in the ears; and a faint high ring that comes with it. set(level).
  lightsPressure() {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.05, srcs = [], bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);
    // the beat: 32 and 34.3 Hz and a little of the octave, beating about twice a second
    { const v = ctx.createGain(); v.gain.value = 0.1; v.connect(bus);
      for (const [f, g] of [[32, 1], [34.3, 0.9], [64.6, 0.3]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(v); o.start(t); srcs.push(o); } }
    // fullness in the ears: a low band of noise that sits still
    { const a = A._fband(95, 0.8, 0.9, 0, bus); a.gain.setValueAtTime(1, t); srcs.push(a.src); }
    // the ring: very faint, high and narrow, in both ears
    { const a = A._fband(7600, 40, 0.5, 0.3, bus), b = A._fband(7640, 40, 0.5, -0.3, bus); a.gain.setValueAtTime(1, t); b.gain.setValueAtTime(1, t); srcs.push(a.src, b.src); }
    // (scheduling)
    return A._floop(srcs, bus, () => {}, (level = 1) => { bus.gain.setTargetAtTime(Math.max(0.0001, level), ctx.currentTime, 0.5); });
  },
  // The three lights coming on where the laser drew, one after another 0.6 s apart: each a deep soft push of pressure and a
  // low hull-like resonance swelling under it, as if something very large had arrived without a sound of its own.
  lightsAnswer() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the push: one for each light
    for (let i = 0; i < 3; i++) A._thump(t + i * 0.6, 40 - i * 2, 1.1, 0.26);
    // the resonance: a vast low body answering each push
    for (let i = 0; i < 3; i++) A._body(t + i * 0.6, [68 - i * 3, 104 - i * 4, 157 - i * 5], 2.4, 0.56, { q: 60, swell: 0.12 });
  },
  // The others stopping, everything at once (the scene cuts the tones and the night air dead on the same frame): a dull,
  // deep close, like a heavy door shut somewhere far off; the ears suddenly full, as in a lift or a plane coming down;
  // and the silence after it ringing.
  switchOff() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the close
    A._thump(t, 44, 0.9, 0.24); A._body(t, [92, 141, 203], 0.9, 0.012, { q: 30 });
    // the ears: a low fullness that arrives in an instant, presses, and eases over a few seconds (it stays at its pitch)
    { const a = A._fband(110, 0.9, 0.7, 0); a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(1, t + 0.03); a.gain.setValueAtTime(1, t + 1.4); a.gain.exponentialRampToValueAtTime(0.0001, t + 5); a.src.stop(t + 5.1); }
    // the silence ringing: a narrow high band that does not move, fading in and slowly away
    { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = 6200; b.Q.value = 35;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(1.0, t + 1.2); v.gain.exponentialRampToValueAtTime(0.0001, t + 5.5); s.connect(b); b.connect(v); v.connect(master); s.start(t, Math.random()); s.stop(t + 5.6); }
  },
  // Changing bodies: a deep push inward as one lets go and the other takes you; then the other body itself, close: his
  // heartbeat (toMan) or two dry clicks in its hollow head; and the breath caught on arriving (his quick and shallow, its
  // slow and hollow).
  fieldSwitch(toMan = true) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the fold
    A._thump(t, 50, 0.7, 0.28);
    // the body
    if (toMan) { A._thump(t + 0.3, 64, 0.16, 0.22); A._thump(t + 0.56, 58, 0.2, 0.16); }
    else { A._body(t + 0.25, [1850, 2950, 4100], 0.07, 0.1, { q: 50 }); A._body(t + 0.33, [1700, 2800, 3900], 0.06, 0.08, { q: 50 }); }
    // the breath
    { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(), d = toMan ? 0.45 : 0.9; s.buffer = noiseBuf; s.loop = true;
      b.type = 'bandpass'; b.frequency.value = toMan ? 1300 : 480; b.Q.value = 1.4;
      v.gain.setValueAtTime(0.0001, t + 0.2); v.gain.exponentialRampToValueAtTime(toMan ? 0.54 : 0.67, t + 0.2 + d * 0.6); v.gain.exponentialRampToValueAtTime(0.0001, t + 0.2 + d);
      s.connect(b); b.connect(v); v.connect(master); s.start(t + 0.2, Math.random()); s.stop(t + 0.25 + d); }
  },
  // The pickup: the column's hum (a deep note, its fifth and octave, a slow beat in it) building as the light comes up and
  // holding; at lift seconds the ground letting go of his weight, a deep soft release; and the pressure in the ears growing
  // as he goes up. Returns { stop(sec) } for the hum.
  fieldPickup(lift = 5.4) {
    if (!ctx) return { stop() {} };
    const t = ctx.currentTime + 0.02, srcs = [], bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);
    // the hum
    { const v = ctx.createGain(); v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.09, t + 2.6); v.connect(bus);
      for (const [f, g, ty] of [[55, 1, 'sine'], [82.7, 0.55, 'sine'], [110.4, 0.4, 'triangle'], [165.5, 0.12, 'triangle']]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = ty; o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(v); o.start(t); srcs.push(o); } }
    // the ground letting go
    A._thump(t + lift, 38, 1.5, 0.3); A._body(t + lift, [138, 226, 309], 1.3, 0.02, { q: 25 });
    // pressure in the ears, growing as he rises (its level climbs; it stays at its pitch)
    { const a = A._fband(170, 1.0, 0.8, 0, bus); a.gain.setValueAtTime(0.0001, t + lift); a.gain.exponentialRampToValueAtTime(1, t + lift + 6); srcs.push(a.src); }
    // (handle)
    const h = { stop(sec = 1) { const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4); for (const s of srcs) { try { s.stop(n + sec + 0.2); } catch (_) {} } live.delete(h); } };
    live.add(h); return h;
  },
  // The triangle opening overhead: a vast low resonance, as if a hull the size of the sky had been struck very softly,
  // with a deep push under it.
  fieldOpen() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the resonance
    A._body(t, [46, 69, 93, 128, 171], 5.5, 0.75, { q: 90, swell: 0.7 });
    // the push
    A._thump(t, 33, 2.6, 0.32);
  },
  // The view folding through time (the 4D turn, about 5.6 s): a huge low body blooming as space bends, a fullness in the
  // ears that holds while it is turned, the tall one's hollow body creaking under the strain, and a deep push as it
  // settles back. Every band stays at its pitch; only the loudness moves.
  fieldFold() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the bloom: a vast resonance swelling up and dying slowly
    A._body(t, [52, 78, 104, 157], 4.6, 0.38, { q: 70, swell: 1.4 });
    // the ears: a still low fullness, up while the view is turned, then gone
    { const a = A._fband(125, 1.1, 0.8, 0); a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(1, t + 1.6); a.gain.setValueAtTime(1, t + 3.2); a.gain.exponentialRampToValueAtTime(0.0001, t + 5.4); a.src.stop(t + 5.6); }
    // the body: two dry creaks of chitin plates in the hollow chest, taking the strain
    A._body(t + 0.9, [410, 930, 1650], 0.35, 0.12, { q: 40 }); A._body(t + 2.3, [380, 870, 1590], 0.4, 0.1, { q: 40 });
    // the settling: a deep soft push as it all comes back
    A._thump(t + 4.0, 40, 1.4, 0.13);
  },
  // The medallion lifting off the robe (about 1.4 s): its heavy chain links sliding and ticking against each other as it
  // draws out, the disc's own low ring as it comes free, and the soft knock as the hook takes it.
  fieldMedal(take = 1.4) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02, R = Math.random;
    // the chain: small metal links ticking against each other, thicker as it pulls taut
    for (let i = 0; i < 16; i++) { const at = t + Math.pow(i / 16, 0.8) * 1.1 + R() * 0.04; A._body(at, [2600 + R() * 700, 4300 + R() * 900, 6900 + R() * 800], 0.07, 0.05 + 0.04 * (i / 16), { q: 70 }); }
    // the disc: a heavy gold plate ringing low as it swings free of the cloth
    A._body(t + 0.25, [540, 1310, 2290], 1.6, 0.06, { q: 120, swell: 0.08 });
    // the hook taking it: a dull knock of chitin on metal
    A._body(t + take, [380, 870, 1720], 0.25, 0.25, { q: 35 }); A._thump(t + take, 90, 0.12, 0.08);
  },
  // One of the triangle's lights waking where the eyes have settled, about 2 s (n: how many woke before it; each sits a
  // little lower, so the three build into one deep chord): a pressure building in the chest, the ears filling with it, a
  // vast low body rubbed up into resonance as the light swells in, and a soft deep push as it arrives and holds. Every
  // band stays at its pitch; only the loudness moves.
  lightWake(n = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02, k = [1, 0.89, 0.8][Math.min(2, Math.max(0, n))];
    // the pressure: two deep tones a couple of hertz apart, beating, building in level
    { const v = ctx.createGain(); v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.085, t + 1.2); v.gain.setTargetAtTime(0.0001, t + 1.5, 0.5); v.connect(master);
      for (const [f, g] of [[41 * k, 1], [43.2 * k, 0.85], [82 * k, 0.3]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(v); o.start(t); o.stop(t + 4.2); } }
    // the ears filling: a low band of noise rising with it
    { const a = A._fband(120 * k, 0.9, 1.3, 0); a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(1, t + 1.2); a.gain.setTargetAtTime(0.0001, t + 1.4, 0.6); a.src.stop(t + 4.5); }
    // the body: a vast low resonance rubbed up into sound as the light comes
    A._body(t + 0.2, [66 * k, 99 * k, 132 * k, 198 * k], 2.6, 0.5, { q: 60, swell: 1.0 });
    // the arrival: a soft deep push as it holds
    A._thump(t + 1.2, 38 * k, 1.2, 0.24);
  },
  // The medallion's beam, held (a loop): the gold disc singing as if bowed, its own modes (the ones it rang with as it came
  // free of the robe) held up steadily; a warm deep hum under it, two of its notes beating slowly; and a close pressure in the
  // air in front of the face. set(on, k): on (0..1) is how surely the beam is on him: on him it swells and the disc sings
  // out; off him it thins to a quieter hum with the ring nearly gone. k (0..1) is how far he has come up: the hum strains a
  // little louder. stop(sec).
  fieldBeam() {
    if (!ctx) return { set() {}, stop() {} };
    const t = ctx.currentTime + 0.05, srcs = [], bus = ctx.createGain(); bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(1, t + 1.0); bus.connect(master);
    const ringBus = ctx.createGain(), humBus = ctx.createGain(); ringBus.gain.value = 1; humBus.gain.value = 1; ringBus.connect(bus); humBus.connect(bus);
    // the hum: a deep warm note, its octave and twelfth; the root doubled half a hertz apart, beating slowly
    { const v = ctx.createGain(); v.gain.value = 0.045; v.connect(humBus);
      for (const [f, g, ty] of [[73.4, 1, 'sine'], [73.9, 0.7, 'sine'], [146.8, 0.4, 'triangle'], [220.2, 0.15, 'triangle']]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = ty; o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(v); o.start(t); srcs.push(o); } }
    // the disc singing: its modes held up by a steady rub, each a narrow band of noise that stays where it is
    for (const [f, g, p] of [[540, 1, -0.15], [1310, 0.55, 0.15], [2290, 0.3, 0]]) { const a = A._fband(f, 90, g * 3.2, p, ringBus); a.gain.setValueAtTime(1, t); srcs.push(a.src); }
    // the air pressing: a close low band of noise in front of the face
    { const a = A._fband(160, 1.1, 0.5, 0, humBus); a.gain.setValueAtTime(1, t); srcs.push(a.src); }
    // (handle)
    const h = {
      set(on = 1, k = 0) { const n = ctx.currentTime; ringBus.gain.setTargetAtTime(0.06 + 0.94 * on, n, 0.25); humBus.gain.setTargetAtTime((0.45 + 0.55 * on) * (1 + 0.4 * k), n, 0.3); },
      stop(sec = 1) { const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4); for (const s of srcs) { try { s.stop(n + sec + 0.2); } catch (_) {} } live.delete(h); },
    };
    live.add(h); return h;
  },
  // ==== end field cues ====
  // ==== reveal cues (js/scenes/reveal.js) ====
  // the audio clock (seconds), for scenes that lay sounds out against the music
  get clock() { return ctx ? ctx.currentTime : 0; },
  // ---- the tune ----
  // One melody, heard hummed (in the memories, and by the child) and as the reveal's music. 6/8, an eighth 0.27 s, a bar
  // 1.62 s, eight bars: the first four are the hummed phrase (D, F, E, A; G, a flat E-flat, D, held), the last four its
  // answer (D, F, E; B-flat, A; G, F, E; D). The E-flat is 308.6 Hz in every voice, a shade under true.
  // _TUNE: [start in eighths, length in eighths, Hz]. _CHORDS: the held chord under each bar, led smoothly (D minor, F over
  // C, the flat E-flat, D minor; D minor, B-flat over D, C, D minor). _BASS: the low note on each bar's downbeat.
  _T8: 0.27,
  _TUNE: [[0, 2, 293.66], [2, 1, 349.23], [3, 3, 329.63], [6, 5, 440], [12, 2, 392], [14, 1, 308.6], [15, 7, 293.66],
    [24, 2, 293.66], [26, 1, 349.23], [27, 3, 329.63], [30, 3, 466.16], [33, 3, 440], [36, 2, 392], [38, 1, 349.23], [39, 3, 329.63], [42, 4, 293.66]],
  _CHORDS: [[146.83, 174.61, 220], [130.81, 174.61, 220], [154.3, 196, 233.08], [146.83, 174.61, 220],
    [146.83, 174.61, 220], [146.83, 174.61, 233.08], [130.81, 164.81, 196], [146.83, 174.61, 220]],
  _BASS: [73.42, 65.41, 77.15, 73.42, 73.42, 58.27, 65.41, 73.42],
  // The tune's notes from bar `from` for `bars` bars (wrapping round the eight), as [start, end, Hz] in audio time with
  // bar `from` starting at t; each note ends a hair early (gap) so the voices can breathe between phrases.
  _tuneEv(t, from, bars, gap = 0.03) {
    const T8 = A._T8, out = [];
    for (let k = 0; k < bars; k++) {
      const b = (from + k) % 8;
      for (const [e, l, f] of A._TUNE) if (e >= b * 6 && e < b * 6 + 6) { const a = t + (k * 6 + e - b * 6) * T8; out.push([a, a + l * T8 - gap, f, l]); }
    }
    return out;
  },
  // The glottal source shared by the hummed voices: a pulse whose harmonics fall away about 11 dB an octave, as a voice's
  // do (a little more of the second and third, where a soft voice has its weight).
  _glottal() {
    if (!A._glot || A._glotCtx !== ctx) {
      const N = 40, re = new Float32Array(N), im = new Float32Array(N);
      for (let n = 1; n < N; n++) im[n] = Math.pow(n, -1.85) * (n === 2 ? 1.25 : n === 3 ? 1.1 : 1);
      A._glot = ctx.createPeriodicWave(re, im); A._glotCtx = ctx;
    }
    return A._glot;
  },
  // looping noise from at to end through a low-pass at lp Hz (returns the filter, to connect onward)
  _noiseLP(at, end, lp) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = lp;
    s.connect(f); s.start(at, Math.random()); s.stop(end); return f;
  },
  // The tune hummed by a person. Voice: the glottal pulse slid from note to note, each note scooped up into (the first of
  // a phrase from further below), its vibrato growing in after each onset, drifting a little flat over each phrase, with
  // slow wavers, cycle-to-cycle jitter in pitch and shimmer in loudness (no voice holds a note dead still), and a breath
  // of aspiration pulsing with each cycle. Through the throat and the nose: the nasal murmur's low resonance, a soft
  // throat resonance above it, the closed mouth's anti-resonance hollowing the middle, two weak high nasal resonances
  // (a hum's buzz), the shut lips damping everything above; on the long notes the lips part a crack (less damping, the
  // anti-resonance moving up, more throat). Breath: air through the nose under the notes. Breath in: a real breath before
  // each phrase, through the nose and down into the chest. Chest: the low of the voice, felt more than heard.
  // voice 0: the grey in the remembered room: a darker, lower-sounding head, steady and clear. 1: the child: an octave up,
  // a small light head, a quicker, less even vibrato. 2: the child under their breath: half voice, half air.
  // o.at: when bar o.from (default 0) starts (audio clock), or o.in seconds from now (at least 0.65, for the breath);
  // o.bars: how many bars (default 4: the hummed phrase), wrapping round the eight. o.pan. Returns the time to the end.
  hum(voice = 0, level = 1, o = {}) {
    if (!ctx) return 7;
    const kid = voice > 0, airy = voice === 2, fm = kid ? 1.3 : 0.9, oct = kid ? 2 : 1;
    const t = Math.max(ctx.currentTime + 0.65, o.at ?? ctx.currentTime + (o.in ?? 0));
    const ev = A._tuneEv(t, o.from || 0, o.bars || 4, airy ? 0.09 : 0.04).filter((e) => e[0] >= t - 0.001);
    if (!ev.length) return 0;
    const t0 = ev[0][0], end = ev[ev.length - 1][1] + 0.45, verb = A._verb(0.3), pan = o.pan ?? 0;
    const starts = ev.map(([a], i) => !i || a - ev[i - 1][1] > 0.2);   // a note that begins a phrase (after a breath)
    const pitch = (p, mul) => {
      p.setValueAtTime(ev[0][2] * mul * 0.9, t0 - 0.1);
      ev.forEach(([a, b, f], i) => {
        const prev = starts[i] ? f * (i ? 0.94 : 0.9) : ev[i - 1][2];
        p.setValueAtTime(prev * mul, a); p.exponentialRampToValueAtTime(f * mul, a + (starts[i] ? 0.16 : 0.075)); p.setValueAtTime(f * mul, b);
      });
    };
    const shape = (p, g) => {
      p.value = 0; p.setValueAtTime(0.0001, t0 - 0.1);   // silent until then (sources may start earlier)
      ev.forEach(([a, b], i) => {
        const last = i === ev.length - 1 || starts[i + 1];
        if (starts[i]) { p.setValueAtTime(0.0001, a); p.exponentialRampToValueAtTime(g, a + 0.1); } else p.linearRampToValueAtTime(g, a + 0.06);
        if (last) { p.setValueAtTime(g, Math.max(a + 0.1, b - 0.25)); p.exponentialRampToValueAtTime(g * 0.5, b); p.exponentialRampToValueAtTime(0.0001, b + 0.2); }
        else { p.setValueAtTime(g, b - 0.05); p.linearRampToValueAtTime(g * 0.8, b); }
      });
    };
    // voice: the glottal pulse through throat and nose, wavering, with aspiration
    { const os = ctx.createOscillator(); os.setPeriodicWave(A._glottal()); pitch(os.frequency, oct);
      // vibrato, growing in over each note's first third of a second; slow wavers; drift flat over each phrase; jitter
      const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = kid ? 5.9 : 5.1; vib.connect(vg); vg.connect(os.frequency);
      vg.gain.setValueAtTime(0, t0 - 0.1);
      ev.forEach(([a, b, f, l]) => { const dep = f * oct * (kid ? 0.014 : 0.011) * (l > 2 ? 1 : 0.5); vg.gain.setValueAtTime(0, a); vg.gain.linearRampToValueAtTime(dep, Math.min(b, a + 0.32)); });
      const wav = [[3.1, 0.0025], [4.7, 0.002], [0.43, 0.003]].map(([fr, d]) => { const w = ctx.createOscillator(), wg = ctx.createGain(); w.frequency.value = fr * (kid ? 1.17 : 1); wg.gain.value = 294 * oct * d * (kid ? 1.5 : 1); w.connect(wg); wg.connect(os.frequency); return w; });
      os.detune.setValueAtTime(0, t0 - 0.1); ev.forEach(([a, b], i) => { if (starts[i]) os.detune.setValueAtTime(0, a); os.detune.linearRampToValueAtTime(-(kid ? 12 : 8) * ((i - ev.findLastIndex((_, j) => j <= i && starts[j])) + 1) / 7, b); });
      const jit = ctx.createGain(); jit.gain.value = kid ? 420 : 300; A._noiseLP(t0 - 0.6, end, 30).connect(jit); jit.connect(os.detune);
      const nas = ctx.createBiquadFilter(), thr = ctx.createBiquadFilter(), zero = ctx.createBiquadFilter(), ring = ctx.createBiquadFilter(), ring2 = ctx.createBiquadFilter(), lip = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), sh = ctx.createGain(), v = ctx.createGain();
      nas.type = 'peaking'; nas.frequency.value = 265 * fm; nas.Q.value = 1.5; nas.gain.value = 7;
      thr.type = 'peaking'; thr.frequency.value = 560 * fm; thr.Q.value = 2.5; thr.gain.value = 2;
      zero.type = 'notch'; zero.frequency.value = 1150 * fm; zero.Q.value = 3;
      ring.type = 'peaking'; ring.frequency.value = 2150 * fm; ring.Q.value = 3; ring.gain.value = 9;
      ring2.type = 'peaking'; ring2.frequency.value = 2950 * fm; ring2.Q.value = 4; ring2.gain.value = 6;
      lip.type = 'highshelf'; lip.frequency.value = 1500 * fm; const shut = airy ? -6 : -10;
      lip.gain.setValueAtTime(shut, t0 - 0.1); thr.gain.setValueAtTime(2, t0 - 0.1); zero.frequency.setValueAtTime(1150 * fm, t0 - 0.1);
      ev.forEach(([a, b, , l]) => { if (l >= 3) { const m = a + (b - a) * 0.55;
        lip.gain.setValueAtTime(shut, a + 0.12); lip.gain.linearRampToValueAtTime(shut + 4, m); lip.gain.linearRampToValueAtTime(shut, b);
        thr.gain.setValueAtTime(2, a + 0.12); thr.gain.linearRampToValueAtTime(5, m); thr.gain.linearRampToValueAtTime(2, b);
        zero.frequency.setValueAtTime(1150 * fm, a + 0.12); zero.frequency.linearRampToValueAtTime(1350 * fm, m); zero.frequency.linearRampToValueAtTime(1150 * fm, b); } });
      lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.5;
      // loudness never quite still: slow wavers and fast shimmer
      sh.gain.value = 1; for (const [fr, d] of [[7.3, 0.05], [11.9, 0.035]]) { const w = ctx.createOscillator(), wg = ctx.createGain(); w.frequency.value = fr; wg.gain.value = d; w.connect(wg); wg.connect(sh.gain); w.start(t0 - 0.1); w.stop(end); }
      { const shm = ctx.createGain(); shm.gain.value = 3; A._noiseLP(t0 - 0.6, end, 40).connect(shm); shm.connect(sh.gain); }
      // aspiration: air noise in the throat, pulsing with each glottal cycle
      const asp = ctx.createGain(), ab = ctx.createBiquadFilter(), am = ctx.createOscillator(), ag = ctx.createGain();
      ab.type = 'bandpass'; ab.frequency.value = 2600 * fm; ab.Q.value = 0.8; A._noiseLP(t0 - 0.6, end, 9000).connect(ab); ab.connect(asp); asp.gain.value = 0;
      am.type = 'triangle'; pitch(am.frequency, oct); ag.gain.value = airy ? 0.5 : 0.22; am.connect(ag); ag.connect(asp.gain); asp.connect(nas);
      shape(v.gain, (airy ? 0.1 : kid ? 0.22 : 0.2) * level);
      os.connect(nas); nas.connect(thr); thr.connect(zero); zero.connect(ring); ring.connect(ring2); ring2.connect(lip); lip.connect(lp); lp.connect(sh); sh.connect(v); v.connect(A._out(pan, 0.85, verb, 0.35));
      for (const x of [os, vib, am]) { x.start(t0 - 0.1); x.stop(end); } for (const w of wav) { w.start(t0 - 0.1); w.stop(end); }
    }
    // breath: air through the nose under every note
    { const b = ctx.createBiquadFilter(), v = ctx.createGain();
      b.type = 'bandpass'; b.frequency.value = 1350 * fm; b.Q.value = 0.6; A._noiseLP(t0 - 0.6, end, 3600).connect(b);
      shape(v.gain, (airy ? 0.36 : kid ? 0.26 : 0.34) * level); b.connect(v); v.connect(A._out(pan, 0.9, verb, 0.2));
    }
    // breath in: before each phrase, a real breath, through the nose (high) and filling the chest (low), quickening to a stop
    { const hi = ctx.createBiquadFilter(), lo = ctx.createBiquadFilter(), vh = ctx.createGain(), vl = ctx.createGain(), n = A._noiseLP(t0 - 0.6, end, 8000);
      hi.type = 'bandpass'; hi.frequency.value = 1900 * fm; hi.Q.value = 1.1; lo.type = 'bandpass'; lo.frequency.value = 520 * fm; lo.Q.value = 0.8;
      n.connect(hi); n.connect(lo); hi.connect(vh); lo.connect(vl);
      for (const v of [vh, vl]) { v.gain.value = 0; v.gain.setValueAtTime(0.0001, t0 - 0.6); }
      ev.forEach(([a], i) => { if (!starts[i]) return; const s = a - 0.48, g = (airy ? 0.42 : kid ? 0.26 : 0.5) * level;
        for (const [v, k] of [[vh, 1], [vl, 0.6]]) { v.gain.setValueAtTime(0.0001, s); v.gain.exponentialRampToValueAtTime(g * k * 0.5, s + 0.18); v.gain.exponentialRampToValueAtTime(g * k, s + 0.36); v.gain.exponentialRampToValueAtTime(0.0001, s + 0.44); } });
      const o2 = A._out(pan, 0.9, verb, 0.2); vh.connect(o2); vl.connect(o2);
    }
    // chest: the low of the voice, the same notes, felt in the chest more than heard
    { const os = ctx.createOscillator(), lp = ctx.createBiquadFilter(), v = ctx.createGain();
      os.type = 'triangle'; pitch(os.frequency, kid ? 1 : 1); lp.type = 'lowpass'; lp.frequency.value = kid ? 700 : 420; lp.Q.value = 0.5;
      shape(v.gain, (airy ? 0.04 : kid ? 0.1 : 0.22) * level);
      os.connect(lp); lp.connect(v); v.connect(A._out(pan, 1, verb, 0.15)); os.start(t0 - 0.1); os.stop(end);
    }
    return end - ctx.currentTime;
  },
  // The closed-mouth buzz the tune was first sung in (build 157, unchanged): a softened buzz slid from note to note (each
  // phrase's first note scooped up from below) through the resonances of a mouth kept shut, with air leaking round every
  // note, a breath in before each phrase, and the notes an octave down in the chest. voice 0: steady, a shade too even;
  // voice 1: smaller-mouthed, breathier, less steady. With no o.ev it sings the seven notes in their first rhythm;
  // o.ev: [start, end, Hz] notes to sing instead (audio time); o.dest: where it goes (default the master). Returns its length.
  lull(voice = 0, level = 1, o = {}) {
    if (!ctx) return 5.6;
    const t = o.ev ? o.ev[0][0] - 0.38 : ctx.currentTime + 0.05, kid = voice === 1, fm = kid ? 1.24 : 1;
    let ev = o.ev, end;
    if (!ev) {
      ev = []; let at = t + 0.38;
      for (const [f, d] of [[293.66, 0.5], [349.23, 0.5], [329.63, 0.75], [440, 0.95], [0, 0.3], [392, 0.5], [308.6, 0.68], [293.66, 1.35]]) { if (f) ev.push([at, at + d, f]); at += d; }
      end = at + 0.3;
    } else end = ev[ev.length - 1][1] + 0.3;
    const out = o.dest || master;
    const breaths = ev.filter(([a], i) => !i || a - ev[i - 1][1] > 0.2).map(([a], i) => [i ? a - 0.3 : t + 0.02, i ? 0.24 : 0.32]);
    const pitch = (p, mul) => {
      p.setValueAtTime(ev[0][2] * mul * 0.94, t);
      ev.forEach(([a, b, f], i) => { p.setValueAtTime((i ? ev[i - 1][2] : f * 0.94) * mul, a); p.exponentialRampToValueAtTime(f * mul, a + (i ? 0.085 : 0.16)); p.setValueAtTime(f * mul, b); });
    };
    const shape = (p, g) => {
      p.setValueAtTime(0.0001, t);
      ev.forEach(([a, b], i) => {
        const first = !i || ev[i - 1][1] < a - 0.01, last = i === ev.length - 1;
        if (first) { p.setValueAtTime(0.0001, a); p.exponentialRampToValueAtTime(g, a + 0.14); } else p.linearRampToValueAtTime(g, a + 0.09);
        if (last) { p.setValueAtTime(g, a + (b - a) * 0.35); p.exponentialRampToValueAtTime(0.0001, b + 0.25); }
        else if (ev[i + 1][0] > b + 0.01) { p.setValueAtTime(g, b - 0.1); p.exponentialRampToValueAtTime(0.0001, b + 0.08); }
        else { p.setValueAtTime(g, b - 0.07); p.linearRampToValueAtTime(g * 0.66, b); }
      });
    };
    // the voice: a softened buzz through a closed mouth's three resonances, wavering a little
    { const os = ctx.createOscillator(), lp = ctx.createBiquadFilter(), v = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain(), dr = ctx.createOscillator(), dg = ctx.createGain();
      os.type = 'sawtooth'; pitch(os.frequency, 1); lp.type = 'lowpass'; lp.frequency.value = kid ? 1700 : 1150; lp.Q.value = 0.3;
      vib.frequency.value = kid ? 5.9 : 5.1; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(kid ? 3.4 : 1.5, t + 1.6); vib.connect(vg); vg.connect(os.frequency);
      dr.frequency.value = kid ? 0.83 : 0.47; dg.gain.value = kid ? 2.6 : 0.5; dr.connect(dg); dg.connect(os.frequency);
      os.connect(lp);
      for (const [f, q, g] of [[290, 4, 1], [1080, 7, 0.2], [2500, 8, 0.07]]) { const b = ctx.createBiquadFilter(), bg = ctx.createGain(); b.type = 'bandpass'; b.frequency.value = f * fm; b.Q.value = q; bg.gain.value = g; lp.connect(b); b.connect(bg); bg.connect(v); }
      shape(v.gain, 0.5 * level); v.connect(out);
      os.start(t); vib.start(t); dr.start(t); os.stop(end); vib.stop(end); dr.stop(end);
    }
    // breath: air leaking round each note, a breath in before each phrase
    { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(), b2 = ctx.createBiquadFilter(), v2 = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true; b.type = 'bandpass'; b.frequency.value = 2300 * fm; b.Q.value = 0.8; v.gain.value = 0; shape(v.gain, (kid ? 0.2 : 0.19) * level);
      b2.type = 'bandpass'; b2.frequency.value = 1500 * fm; b2.Q.value = 1.3; v2.gain.value = 0; v2.gain.setValueAtTime(0.0001, t);
      for (const [a, d] of breaths) { v2.gain.setValueAtTime(0.0001, a); v2.gain.exponentialRampToValueAtTime((kid ? 0.2 : 0.24) * level, a + d * 0.6); v2.gain.exponentialRampToValueAtTime(0.0001, a + d); }
      s.connect(b); b.connect(v); v.connect(out); s.connect(b2); b2.connect(v2); v2.connect(out); s.start(t, Math.random()); s.stop(end);
    }
    // chest: the same notes an octave down, felt more than heard
    { const os = ctx.createOscillator(), lp = ctx.createBiquadFilter(), v = ctx.createGain();
      os.type = 'triangle'; pitch(os.frequency, 0.5); lp.type = 'lowpass'; lp.frequency.value = 280; shape(v.gain, (kid ? 0.075 : 0.11) * level);
      os.connect(lp); lp.connect(v); v.connect(out); os.start(t); os.stop(end);
    }
    return end - ctx.currentTime;
  },
  // One stretch of the reveal's lullaby, bars o.from to o.to (default all eight), bar o.from starting at o.at. The lead is
  // the closed-mouth buzz (lull) singing the tune; under it, gently: a soft held chord on each bar, a low note on each
  // downbeat, and now and then one light plucked note. Each layer goes to o.dest[layer] (music() gives each its own
  // level) or into a room of its own.
  _lullaby(o = {}) {
    if (!ctx) return 0;
    const T8 = A._T8, BAR = 6 * T8, from = o.from ?? 0, to = o.to ?? 8, dest = o.dest || {};
    const t0 = Math.max(o.at ?? 0, ctx.currentTime + 0.45), t1 = t0 + (to - from) * BAR;
    let verb = null; const out = (k, dry, wet) => dest[k] || A._out(0, dry, verb || (verb = A._verb(0.45)), wet);
    // lead: the closed-mouth buzz singing the tune
    { const ev = A._tuneEv(t0, from, to - from, 0.03); if (ev.length) A.lull(0, 1, { ev, dest: out('lead', 0.8, 0.5) }); }
    // chord: a soft held chord on each bar, two slightly detuned soft-edged voices a note, swelling in and handing over
    for (let b = from; b < to; b++) {
      const at = t0 + (b - from) * BAR, v = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.4;
      v.gain.value = 0; v.gain.setValueAtTime(0.0001, at - 0.3); v.gain.linearRampToValueAtTime(0.058, at + 0.35); v.gain.setValueAtTime(0.058, at + BAR - 0.3); v.gain.linearRampToValueAtTime(0.0001, at + BAR + 0.3);
      for (const f of A._CHORDS[b % 8]) for (const [ty, det, g] of [['triangle', -4, 1], ['sawtooth', 5, 0.35]]) {
        const os = ctx.createOscillator(), og = ctx.createGain(); os.type = ty; os.frequency.value = f; os.detune.value = det; og.gain.value = g;
        os.connect(og); og.connect(lp); os.start(at - 0.3); os.stop(at + BAR + 0.35);
      }
      lp.connect(v); v.connect(out('chord', 0.6, 0.8));
    }
    // low: a low note on each bar's downbeat, a soft felt-struck string, the note and its octave, dying through the bar
    for (let b = from; b < to; b++) {
      const at = t0 + (b - from) * BAR, f = A._BASS[b % 8], os = ctx.createOscillator(), o2 = ctx.createOscillator(), og = ctx.createGain(), lp = ctx.createBiquadFilter(), v = ctx.createGain();
      os.type = 'triangle'; os.frequency.value = f; o2.frequency.value = f * 2; og.gain.value = 0.3; lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.7;
      v.gain.value = 0; v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.12, at + 0.06); v.gain.exponentialRampToValueAtTime(0.0001, at + BAR * 0.95);
      os.connect(lp); o2.connect(og); og.connect(lp); lp.connect(v); v.connect(out('low', 0.85, 0.3));
      for (const x of [os, o2]) { x.start(at); x.stop(at + BAR); }
    }
    // pluck: now and then one light plucked note high over the chord (bars 3 and 7, on the half bar): a small steel tooth,
    // its overtone dying fast, through a little wooden box
    for (const [b, f] of [[3, 880], [7, 587.33]]) {
      if (b < from || b >= to) continue;
      const at = t0 + ((b - from) * 6 + 3) * T8, bx = ctx.createBiquadFilter(); bx.type = 'peaking'; bx.frequency.value = 720; bx.Q.value = 1.2; bx.gain.value = 5;
      bx.connect(out('pluck', 0.7, 0.7));
      for (const [m, gm, d] of [[1, 1, 2.2], [1.0017, 0.45, 1.9], [6.27, 0.14, 0.25]]) {
        const os = ctx.createOscillator(), v = ctx.createGain(); os.frequency.value = f * m;
        v.gain.value = 0; v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.06 * gm, at + 0.002); v.gain.exponentialRampToValueAtTime(0.0001, at + d);
        os.connect(v); v.connect(bx); os.start(at); os.stop(at + d + 0.05);
      }
    }
    return t1 - ctx.currentTime;
  },
  // The reveal's lullaby for as long as the scene wants it: _lullaby laid out two bars at a time a little ahead, round and
  // round the eight bars, each layer through its own level { lead, chord, low, pluck }. o.at / o.in: when bar o.bar (even,
  // default 0) starts. Returns { set(levels, seconds), next(), barTime(bar), stop(seconds) }: next() is the next even bar
  // not yet laid out and when it starts; barTime(b, after) when bar b next starts at or after audio time `after` (default
  // 0.75 s from now).
  music(o = {}) {
    if (!ctx) return { set() {}, next() { return [0, 0]; }, barTime() { return 0; }, stop() {} };
    const T8 = A._T8, BAR = 6 * T8, verb = A._verb(0.45), bus = ctx.createGain(), send = ctx.createGain(), L = {};
    bus.gain.value = 0.6; bus.connect(master); send.gain.value = 0.55; bus.connect(send); send.connect(verb);
    for (const k of ['lead', 'chord', 'low', 'pluck']) { L[k] = ctx.createGain(); L[k].gain.value = (o.levels && o.levels[k]) ?? 1; L[k].connect(bus); }
    let at = Math.max(ctx.currentTime + 0.5, o.at ?? ctx.currentTime + (o.in ?? 0)), bar = (o.bar ?? 0) & ~1, alive = true, timer = 0;
    const origin = () => at - bar * BAR;
    const plan = () => { if (!alive) return; while (at < ctx.currentTime + 2.6) { const b = bar % 8; A._lullaby({ at, from: b, to: b + 2, dest: L }); at += 2 * BAR; bar += 2; } timer = setTimeout(plan, 600); };
    plan();
    const h = {
      set(lv, sec = 2) { const n = ctx.currentTime; for (const k in lv) if (L[k]) { L[k].gain.cancelScheduledValues(n); L[k].gain.setTargetAtTime(lv[k], n, Math.max(0.01, sec / 3)); } },
      next() { return [bar % 8, at]; },
      barTime(b, after) { const n = after ?? ctx.currentTime + 0.75; let tb = origin() + (b % 8) * BAR; while (tb < n) tb += 8 * BAR; return tb; },
      stop(sec = 2) { if (!alive) return; alive = false; clearTimeout(timer); live.delete(h); const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setTargetAtTime(0.0001, n, sec / 4); setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (sec + 4) * 1000); },
    };
    live.add(h);
    return h;
  },
  // The toy playing the tune: bars o.from to o.to on a tiny music box, o.oct octaves up (default 2 = one octave over the
  // voice), bar o.from starting at o.at. Each tooth: its note and a slightly detuned twin, its first overtone (6.27 times up,
  // a bar clamped at one end) dying fast, and the pin's tick; through the little box's two wooden resonances.
  toyTune(o = {}) {
    if (!ctx) return;
    const T8 = A._T8, from = o.from ?? 0, to = o.to ?? 2, oct = o.oct ?? 2, g0 = o.gain ?? 1, at0 = Math.max(o.at ?? 0, ctx.currentTime + 0.1);
    const bx = ctx.createBiquadFilter(), bx2 = ctx.createBiquadFilter();
    bx.type = 'peaking'; bx.frequency.value = 720; bx.Q.value = 1.2; bx.gain.value = 6; bx2.type = 'peaking'; bx2.frequency.value = 1900; bx2.Q.value = 2; bx2.gain.value = 4;
    bx.connect(bx2); bx2.connect(A._out(0, 0.75, A._verb(0.4), 0.55));
    // teeth: the notes, plucked
    for (const [a, , f] of A._tuneEv(at0, from, to - from)) {
      const at = a + (Math.random() - 0.5) * 0.008, fr = f * oct, dd = Math.min(2.8, 2.0 * Math.sqrt(587 / fr));
      for (const [m, gm, dm] of [[1, 1, 1], [1.0017, 0.45, 0.85], [6.27, 0.16, 0.1]]) {
        if (fr * m > 15000) continue;
        const os = ctx.createOscillator(), v = ctx.createGain(); os.frequency.value = fr * m;
        v.gain.value = 0; v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.05 * gm * g0, at + 0.002); v.gain.exponentialRampToValueAtTime(0.0001, at + dd * dm);
        os.connect(v); v.connect(bx); os.start(at); os.stop(at + dd * dm + 0.05);
      }
      const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf;
      b.type = 'bandpass'; b.frequency.value = Math.min(9000, fr * 6); b.Q.value = 2.5;
      v.gain.value = 0; v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.045 * g0, at + 0.0008); v.gain.exponentialRampToValueAtTime(0.0001, at + 0.01);
      s.connect(b); b.connect(v); v.connect(bx); s.start(at, Math.random()); s.stop(at + 0.03);
    }
  },
  // a short burst of band-passed noise (a struck, slapped or popped thing), peaking 1.2 ms after at and gone by at + dec
  _burst(at, fr, q, gain, dec, out) {
    const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf;
    b.type = 'bandpass'; b.frequency.value = fr; b.Q.value = q; v.gain.value = 0; v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(gain, at + 0.0012); v.gain.exponentialRampToValueAtTime(0.0001, at + dec);
    s.connect(b); b.connect(v); v.connect(out); s.start(at, Math.random() * 1.5); s.stop(at + dec + 0.02);
  },
  // A child's small hands clapping once: the skin of two small palms meeting (a short bright slap), the air cupped between
  // them pushed out (a duller, lower pop), and the little room giving it back a moment later.
  clap(level = 1, o = {}) {
    if (!ctx) return;
    const t = o.at ?? ctx.currentTime + 0.01, pan = o.pan ?? 0, g = 2 * level * (0.85 + 0.3 * Math.random()), f = 1 + (Math.random() - 0.5) * 0.12;
    const dry = A._out(pan, 1, null, 0);
    // slap: the skin of the palms meeting, short and bright (a small hand: higher than a grown-up's)
    A._burst(t, 2300 * f, 1.2, 0.9 * g, 0.03, dry);
    // pop: the air cupped between the palms pushed out, lower and rounder
    A._burst(t + 0.001, 820 * f, 2.2, 0.75 * g, 0.045, dry);
    // room: the small padded room giving it back, soft and dull, two reflections close behind
    { const lp = ctx.createBiquadFilter(), v = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 1800; v.gain.value = 1; lp.connect(v); v.connect(dry);
      A._burst(t + 0.011, 1500 * f, 0.9, 0.3 * g, 0.06, lp); A._burst(t + 0.019, 1100 * f, 0.9, 0.22 * g, 0.08, lp); }
  },
  // A memory arriving, set off by the toy: pressure in the ears, the toy's own note rubbed up out of nothing like a
  // wetted glass rim (with its octave and two partials that do not quite agree), and a few specks of glass after it.
  recall(d = 2.6) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // pressure: a slow push in the ears
    A._thump(t, 44, 1.7, 0.2);
    // the rim: the toy's note and its partials, rubbed, swelling and left ringing
    A._body(t + 0.05, [293.66, 587.9, 884, 1183], d, 0.05, { q: 130, swell: d * 0.55 });
    // specks: glass glints scattered after the swell
    A._glints(t + d * 0.4, d * 0.8, 9, 1170, 4700, 0.024, 0.9, 0.03, 1.2);
  },
  // Small fingers touching the jewel: skin landing on something hard, the jewel ringing from the touch, a few specks.
  toyTouch() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // contact: a soft knock of a fingertip
    A._thump(t, 190, 0.1, 0.07);
    // the jewel: rings from the touch, high and short
    A._body(t + 0.004, [1174.7, 1763, 2664, 3540], 2.4, 0.016, { q: 220 });
    // specks: a few glints out of it
    A._glints(t + 0.06, 1.1, 6, 2350, 7000, 0.005, 0.5, 0, 1.3);
  },
  // Everything heard as if through a wall: a low-pass on the whole output, k 0 (open) to 1 (most shut). It opens again
  // by itself about a second after the last call, so a scene holds it shut by calling it every frame, and a scene that
  // is abandoned mid-way cannot leave the game muffled.
  _muffle(k = 1) {
    if (!ctx || !out) return;
    if (!A._wall) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.4; out.disconnect(); out.connect(lp); lp.connect(ctx.destination); A._wall = lp; }
    const n = ctx.currentTime, p = A._wall.frequency;
    p.cancelScheduledValues(n); p.setTargetAtTime(20000 * Math.pow(0.026, Math.max(0, Math.min(1, k))), n, 0.12); p.setTargetAtTime(20000, n + 0.7, 0.4);
  },
  // The nursery, a low padded room deep in the ship: the ship's hum coming through the padding, a slow soft double beat
  // in the floor under the cradle (a heart heard through cushions), and the still hush of a small soft room. A loop:
  // returns { stop(seconds) }. The beat is laid out a few seconds ahead at a time.
  nursery() {
    if (!ctx) return { stop() {} };
    const t = ctx.currentTime + 0.05, bus = ctx.createGain(), nodes = [];
    bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(1, t + 3); bus.connect(master);
    // hum: two low notes a hair apart through a padded wall, beating slowly
    for (const [f, g] of [[49, 0.05], [49.6, 0.04], [98.3, 0.018]]) {
      const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), v = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 0.5; v.gain.value = g;
      o.connect(lp); lp.connect(v); v.connect(bus); o.start(t); nodes.push(o);
    }
    // beat: a soft low double knock every 1.7 s, felt through the floor more than heard
    const beat = (at) => {
      for (const [dl, g] of [[0, 0.07], [0.32, 0.045]]) {
        const o = ctx.createOscillator(), v = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.frequency.setValueAtTime(64, at + dl); o.frequency.exponentialRampToValueAtTime(40, at + dl + 0.28);
        lp.type = 'lowpass'; lp.frequency.value = 140;
        v.gain.setValueAtTime(0.0001, at + dl); v.gain.exponentialRampToValueAtTime(g, at + dl + 0.04); v.gain.exponentialRampToValueAtTime(0.0001, at + dl + 0.34);
        o.connect(lp); lp.connect(v); v.connect(bus); o.start(at + dl); o.stop(at + dl + 0.4);
        // the padding's give: a little pressed air in the same knock
        const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), w = ctx.createGain(); s.buffer = noiseBuf;
        b.type = 'lowpass'; b.frequency.value = 260; w.gain.setValueAtTime(0.0001, at + dl); w.gain.exponentialRampToValueAtTime(g * 0.5, at + dl + 0.05); w.gain.exponentialRampToValueAtTime(0.0001, at + dl + 0.25);
        s.connect(b); b.connect(w); w.connect(bus); s.start(at + dl, Math.random()); s.stop(at + dl + 0.3);
      }
    };
    let next = t + 0.8, alive = true;
    const plan = () => { if (!alive) return; while (next < ctx.currentTime + 6) { beat(next); next += 1.7; } setTimeout(plan, 2000); };
    plan();
    // hush: the still air of a small soft room, no movement in it
    { const s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), v = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true; lp.type = 'lowpass'; lp.frequency.value = 700; hp.type = 'highpass'; hp.frequency.value = 120; v.gain.value = 0.07;
      s.connect(hp); hp.connect(lp); lp.connect(v); v.connect(bus); s.start(t, Math.random()); nodes.push(s); }
    const h = { stop(sec = 1) { alive = false; const n = ctx.currentTime; bus.gain.cancelScheduledValues(n); bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), n); bus.gain.exponentialRampToValueAtTime(0.0001, n + sec); for (const o of nodes) try { o.stop(n + sec + 0.1); } catch (_) {} live.delete(h); } };
    live.add(h);
    return h;
  },
  // A low upholstered couch taking weight (k 0 a hand on it .. 1 someone lying back): the cushion pressing down, the
  // frame under it giving a short creak (stick-slip pulses into the wood's two low modes), the cloth drawn over the seat.
  couch(k = 1) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02, d = 0.5 + 0.9 * k;
    // cushion: air pressed out of the padding, a soft low push
    { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf;
      b.type = 'lowpass'; b.frequency.value = 320; b.Q.value = 0.7;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.16 * (0.4 + k), t + d * 0.35); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(b); b.connect(v); v.connect(master); s.start(t, Math.random()); s.stop(t + d + 0.05); }
    // frame: a creak, a run of tiny slips each ringing the frame's low modes
    { const n = Math.round(6 + 14 * k), span = 0.25 + 0.5 * k;
      for (let i = 0; i < n; i++) {
        const at = t + 0.12 + span * Math.pow(i / n, 0.8) + Math.random() * 0.012, s = ctx.createBufferSource(), e = ctx.createGain(); s.buffer = noiseBuf;
        e.gain.setValueAtTime(0.0001, at); e.gain.exponentialRampToValueAtTime(1, at + 0.002); e.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
        s.connect(e);
        for (const [f, g] of [[183, 0.5], [311, 0.35], [742, 0.12]]) {
          const b = ctx.createBiquadFilter(), v = ctx.createGain(); b.type = 'bandpass'; b.frequency.value = f * (0.97 + 0.06 * i / n); b.Q.value = 18;
          v.gain.setValueAtTime(g * 4.5 * (0.5 + 0.5 * k), at); v.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
          e.connect(b); b.connect(v); v.connect(master);
        }
        s.start(at, Math.random()); s.stop(at + 0.2);
      } }
    // cloth: fabric drawn over the seat, a dry short rustle
    { const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = noiseBuf;
      b.type = 'bandpass'; b.frequency.value = 3200; b.Q.value = 0.8;
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(0.03 * (0.5 + k), t + 0.08); v.gain.setValueAtTime(0.03 * (0.5 + k), t + d * 0.4); v.gain.exponentialRampToValueAtTime(0.0001, t + d * 0.7);
      s.connect(b); b.connect(v); v.connect(master); s.start(t, Math.random()); s.stop(t + d); }
  },
  // ==== end reveal cues ====
  honk() { A.tone(180 + Math.random() * 120, 0.25, { type: 'square', g: 0.12, to: 90 }); },
};

// ---- developer readout: which cues are sounding (F3 in developer mode; engine.js sets A.trace there) ----
// Every public cue is wrapped here once, so no cue needs editing. A call from a scene registers itself with its name and
// first argument; calls a cue makes inside itself (A.tone inside A.blast, A.drone inside A.rise) do not. A one-shot counts
// until the last sound source it started is due to stop (a stop() it hands back, as A.breath does, can cut that short); a
// loop (it hands back a stop() and left a source running with no stop time: drone, rise, carrier, binaural, aura) counts
// until its stop() or A.stopAll. Off (one test per call) unless A.trace is set.
const playing = new Set();
let inCue = null, depth = 0;
const UNTRACED = new Set(['init', 'setMute', 'suspend', 'resume', 'stopAll', 'tap', 'toneAt', '_air', '_body', '_thump', '_glints', '_verb', '_out', '_suck', '_choir', '_comb', '_grains']);
// sources started while a cue runs push its end time out to their own stop time
function traceNodes() {
  if (!ctx || ctx.__traced) return; ctx.__traced = true;
  for (const m of ['createOscillator', 'createBufferSource']) {
    const make = ctx[m].bind(ctx);
    ctx[m] = () => {
      const n = make(), rec = inCue;
      if (rec) {
        if (rec.open) rec.open.add(n);
        const stop = n.stop.bind(n);
        n.stop = (w = 0) => { if (rec.open) rec.open.delete(n); if (rec.end !== Infinity) rec.end = Math.max(rec.end, w || ctx.currentTime); return stop(w); };
      }
      return n;
    };
  }
}
for (const k of Object.keys(A)) {
  const f = A[k];
  if (typeof f !== 'function' || UNTRACED.has(k)) continue;
  A[k] = function (...args) {
    if (!A.trace || !ctx || depth) { depth++; try { return f.apply(this, args); } finally { depth--; } }
    traceNodes();
    const a0 = args[0], arg = typeof a0 === 'number' ? '(' + (+a0.toFixed(2)) + ')' : typeof a0 === 'string' ? '(' + a0 + ')' : '';
    const rec = { name: k + arg, t0: ctx.currentTime, end: ctx.currentTime + 0.05, loop: false, open: new Set() };
    const prev = inCue; inCue = rec; depth++;
    let r; try { r = f.apply(this, args); } finally { depth--; inCue = prev; }
    const open = rec.open.size; rec.open = null;
    if (r && typeof r.stop === 'function') {
      if (open) { rec.end = Infinity; rec.loop = true; }
      const stop = r.stop;
      r.stop = function (sec, ...more) { const by = ctx.currentTime + (typeof sec === 'number' ? sec : 0.6); if (rec.end === Infinity || by < rec.end) rec.end = by; return stop.call(this, sec, ...more); };
    }
    if (playing.size > 120) for (const p of playing) if (p.end < ctx.currentTime) playing.delete(p);
    playing.add(rec);
    return r;
  };
}
{ const stopAll = A.stopAll; A.stopAll = function (sec = 0.3) { if (ctx) for (const p of playing) if (p.end === Infinity) p.end = ctx.currentTime + sec; return stopAll.call(this, sec); }; }
// what is sounding now, newest first: [{ name, age (s), loop, ending }]; ended ones stay listed 0.3 s so short cues can be read
A.playing = () => {
  if (!ctx) return [];
  const now = ctx.currentTime, list = [];
  for (const p of playing) {
    if (p.end + 0.3 < now) { playing.delete(p); continue; }
    list.push({ name: p.name, age: now - p.t0, loop: p.loop, ending: p.end !== Infinity && p.loop });
  }
  return list.sort((a, b) => a.age - b.age);
};
A.state = () => (ctx ? ctx.state + (muted ? ', muted' : '') : 'not started');
