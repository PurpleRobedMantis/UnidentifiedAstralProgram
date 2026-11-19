// Layer levels of one sound cue in js/audio.js, rendered offline, each layer alone and the whole cue together.
//
// Why: new cues kept shipping with most layers 20-45 dB under the loud low ones (build 94: every _body resonator;
// build 99: the portal's tear, creaks, rattle, air and electrics). A thump or growl hides them, so the whole cue
// measures fine and sounds like a rumble. Check every new or changed cue with this before calling it done.
// Aim (loudest 50 ms of each layer against the whole cue): main layers 3-12 dB under, background texture 12-18 dB
// under, never more than 18 (buried: nobody will hear it). The whole cue should peak under about -3 dBFS.
//
// How to run (browser pane, no speakers needed):
//   1. Start the working copy's dev server: preview_start name "game" (port 8766). Port 8765 is the play copy, which
//      has no tools/ folder and may hold an older audio.js.
//   2. Navigate the pane to http://localhost:8766/js/audio.js. It has to be that JS file: HTML pages get a CSP that
//      blocks eval, and this tool needs eval to build each solo version of the cue.
//   3. In javascript_tool:
//        eval(await (await fetch('/tools/levels.js?' + Date.now(), { cache: 'no-store' })).text());
//        await measureCue('portal', [2.6])
//
// Layers are split at the cue's top-level comment blocks (4-space indent, "    // ..."; several comment lines in a
// row count as one split), so start each layer with one. Sections that make no sound (helpers, shared nodes) are kept
// in every render. A layer that needs variables from another layer will throw: move what it shares above the first
// layer. A cue with no such comments is measured whole only.
async function measureCue(name, args = [], { seconds = 14, rate = 48000 } = {}) {
  const src = await (await fetch('/js/audio.js?v=' + Date.now(), { cache: 'no-store' })).text();
  const a = src.indexOf('\n  ' + name + '(');
  if (a < 0) throw new Error('no cue ' + name + ' in audio.js');
  const close = src.indexOf('\n  },\n', a), b = close + 5;          // the cue's closing "  },"
  const lines = src.slice(a + 1, close).split('\n');
  const head = lines.shift();                                        // "  name(args) {"
  const isNote = (l) => /^    \/\/ /.test(l);
  const parts = []; let cur = { label: '(setup)', text: [] }, prev = '';
  for (const l of lines) {
    if (isNote(l) && !isNote(prev)) { parts.push(cur); cur = { label: l.replace(/^    \/\/\s*/, '').slice(0, 48), text: [] }; }
    cur.text.push(l); prev = l;
  }
  parts.push(cur);
  const sounds = (p) => /\.start\(|A\._(air|body|thump|glints|suck|comb|choir|grains)\(|A\.(tone|noise|toneAt)\(/.test(p.text.join('\n'));
  const keep = parts.filter((p) => !sounds(p)), layers = parts.filter(sounds);
  const build = (only) => '\n  ' + head + '\n' + parts.filter((p) => keep.includes(p) || only.includes(p)).map((p) => p.text.join('\n')).join('\n') + '\n  },';
  const db = (x) => (10 * Math.log10(Math.max(x, 1e-12))).toFixed(1);
  async function render(body) {
    const code = (src.slice(0, a) + body + src.slice(b)).replace(/^export /gm, '') + '\nreturn A;';
    let c; const AC = function () { c = new OfflineAudioContext(2, rate * seconds, rate); return c; };
    const A = new Function('window', code)({ AudioContext: AC, localStorage: window.localStorage });
    A.init(); A[name](...args);
    const buf = await c.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), W = Math.round(rate * 0.05);
    let pk = 0, best = 0, at = 0;
    for (let i = 0; i + W <= L.length; i += W) {
      let e = 0; for (let j = i; j < i + W; j++) { e += (L[j] * L[j] + R[j] * R[j]) / 2; pk = Math.max(pk, Math.abs(L[j]), Math.abs(R[j])); }
      e /= W; if (e > best) { best = e; at = i / rate; }
    }
    return { loud: +db(best), at: +at.toFixed(2), peak: +(20 * Math.log10(Math.max(pk, 1e-9))).toFixed(1) };
  }
  const whole = await render(build(layers));
  const rows = [`WHOLE ${name}: loudest ${whole.loud} dB at ${whole.at}s, peak ${whole.peak} dBFS` + (whole.peak > -3 ? '  << TOO HOT' : '')];
  if (layers.length < 2) { rows.push('  (no layer comments in this cue, so it cannot be split: add "    // ..." before each layer)'); return rows.join('\n'); }
  for (const p of layers) {
    let r; try { r = await render(build([p])); } catch (e) { rows.push(`  ${p.label}: ERROR ${e.message}`); continue; }
    const under = +(whole.loud - r.loud).toFixed(1);
    const flag = under > 18 ? '  << BURIED' : under > 12 ? '  (quiet: fine only for background texture)' : under < 3 ? '  (dominant)' : '';
    rows.push(`  ${p.label}: loudest ${r.loud} dB at ${r.at}s (${under} under whole), peak ${r.peak}${flag}`);
  }
  return rows.join('\n');
}
