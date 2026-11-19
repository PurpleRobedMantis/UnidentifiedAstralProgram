// All sound is synthesised with the Web Audio API. No audio files.
let ctx = null, master = null, noiseBuf = null, out = null;
// developer-menu mute, remembered in this browser
let muted = false; try { muted = localStorage.getItem('uap-mute') === '1'; } catch (_) {}
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
export const A = {
  speed: 1,
  get muted() { return muted; },
  // silence everything (or bring it back) at the very end of the chain
  setMute(m) {
    muted = !!m; try { localStorage.setItem('uap-mute', muted ? '1' : '0'); } catch (_) {}
    if (out) out.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
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
    if (!ctx) return;
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
    if (!ctx) return;
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
    if (!ctx) return;
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
    if (!ctx) return;
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
  suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  click() { A.noise(0.03, { g: 0.25, f: 3200, q: 6 }); },
  clicks(n = 4) { for (let i = 0; i < n; i++) setTimeout(A.click, i * 70 + Math.random() * 50); },
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
  // Build 126: no air or noise layers at all (owner: "get rid of swishing noises when scanner locks"). The puff of air
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
  // Bedclothes moving, as you sit up in bed (no flop) or drag the covers off (flop: the covers land). The owner picked
  // this from every version tried (build 111 developer menu): build 106's soft low drag of the covers, with no strokes.
  rustle(d = 1.2, g = 1, { flop = false } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    // the weight of the covers: a soft low drag
    A._air(t, d, 240, 420, 0.7, 0.25 * g, { atk: 0.4 });
    // the covers landing: a soft heavy flop
    if (flop) { A._thump(t + d, 75, 0.25, 0.07 * g); A._air(t + d, 0.4, 700, 280, 0.8, 0.06 * g, { atk: 0.08 }); }
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
  // Build 117: the wall creaks are off (creaks: true brings them back): the owner identified them, from the developer sound
  // list, as the "generic slapping whoosh" they disliked. The tear, wrongly removed in build 115, is back.
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
  // ---- beings coming through the doorway: ethereal, not physical (owner, build 115: "scaryish ethereal cool") ----
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
    // Build 129 (owner): the doorway's roar, building as they come and cut dead the moment they cross the wall plane
    // (lead seconds after the call). The build 125 version (in-drawn swell, ringing sweep, pressure) is kept in
    // docs/spare-sounds/pass-candidates.js. walk is unused now.
    A.passWall(lead);
  },
  // The tall mantis stooping through the doorway and straightening in the room: d = the stoop-through (night.js 3.2 s:
  // head through at about 0.27 d, body through at 0.54 d, upright by 0.58 d), side = the step along the wall after it.
  mantisIn(d = 3.2, side = 1.6) {
    // Build 129 (owner): the same roar, cut dead as the mantis's body comes through the doorway (0.54 d into the stoop).
    // The build 125 version is kept in docs/spare-sounds/pass-candidates.js. side is unused now.
    A.passWall(0.54 * d);
  },
  // ---- passing through the bedroom wall into the doorway's light ----
  // The doorway's roar right in your face, louder as you near the wall, then cut dead as you reach it; in the bedroom the
  // room's drones are silenced at the same moment (night.js). lead = seconds from the call to reaching the wall (night.js
  // calls it as the drift to the wall starts; the view is fully white 3.3 s later, as the eye reaches the wall plane).
  // Build 127: the owner chose this from four build 126 candidates (D, 'sudden silence') and had the ear ringing and the
  // two heartbeats after the cut removed; they wanted the roar. All four originals are kept, unchanged, in
  // docs/spare-sounds/pass-candidates.js. No noise sweeps here (owner: no swishes).
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
