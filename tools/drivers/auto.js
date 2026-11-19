// Generic route driver for tools/shot.js: plays a scene with no skill, answering every choice from a list and
// pressing E whenever a hint offers it, and reports the route taken. Set window.__set first (prepend a line), e.g.
//   window.__set = { picks: [2, 1], fight: false, stop: 'hub', max: 40000 };
// picks: the choice number (1-based) for each choice in order, the last one repeating. fight: press Space at BREAK FREE.
// approach: at the crossroads, stand in front of the mantis once (so E talks to them).
// stop: end when E.sceneName becomes this (default: when an ending card shows). Stalls (nothing on screen changes for
// 3000 frames) are reported with what was showing. Run from PowerShell:
//   node tools/shot.js "dev=1&fast=8&scene=exam" shots/route tools/drivers/auto.js   (after prepending window.__set)
window.__log = window.__log || [];
window.R = { set: window.__set || {}, lines: [], scenes: [E.sceneName], choices: [], stall: null, frames: 0 };
window.rl = () => { const t = (id) => (document.getElementById(id) || {}).textContent || ''; return [t('sub'), t('hint'), t('prompt'), t('choices')].join('¦'); };
{
  const S = R.set, picks = S.picks || [1], max = S.max || 40000;
  let last = rl(), still = 0, nChoice = 0, lastSub = '';
  // fixed overlays have no offsetParent, so test layout boxes and computed style instead
  const vis = (id) => { const e = document.getElementById(id); if (!e || !e.getClientRects().length) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0; };
  let placed = false;
  for (; R.frames < max; R.frames += 5) {
    await steps(5);
    if (S.approach && !placed && E.sceneName === 'hub' && E.mode === 'walk') { placed = true; E.camera.position.set(0, 1.6, 2.0); E.yaw = 0; E.pitch = 0.1; }
    const s = sub(); if (s && s !== lastSub) { R.lines.push(s); lastSub = s; }
    if (E.sceneName !== R.scenes[R.scenes.length - 1]) R.scenes.push(E.sceneName);
    if (S.stop && E.sceneName === S.stop) break;
    if (vis('endcard') && document.getElementById('endTitle').textContent) break;
    const ch = document.getElementById('choices');
    if (ch && vis('choices') && ch.textContent.trim()) {
      const p = picks[Math.min(nChoice, picks.length - 1)], opts = [...ch.children].map((b) => b.textContent.trim());
      R.choices.push(opts.join(' / ') + '  -> ' + opts[p - 1]); nChoice++; E.just.add('Digit' + p); await steps(3);
    }
    const h = document.getElementById('hint').textContent;
    if (/^E —|^E -/.test(h)) E.just.add('KeyE');
    // struggling needs a press every frame or the breathing timer runs out first
    if (S.fight) for (let i = 0; i < 400 && /BREAK FREE/i.test(document.getElementById('prompt').textContent); i++) { E.just.add('Space'); await steps(1); }
    // walk straight on wherever a room asks you to walk (the crossroads is left to the stop condition)
    E.keys.KeyW = E.sceneName === 'room' && /W A S D to walk|stick to walk/.test(h);
    const now = rl();
    if (now === last) { if ((still += 5) >= 3000) { R.stall = now; break; } } else { still = 0; last = now; }
  }
  const G2 = window.UAP.G;
  __log.push('scenes: ' + R.scenes.join(' > '));
  __log.push('frames ' + R.frames + (R.stall ? '  STALLED showing: ' + R.stall.replace(/¦+/g, ' ¦ ') : ''));
  __log.push('choices: ' + (R.choices.join(' || ') || 'none'));
  __log.push('end: ' + (vis('endcard') ? document.getElementById('endTitle').textContent : '-') + '  lucidity ' + G2.lucidity.toFixed(2) + ' trust ' + G2.trust + ' path ' + G2.path + ' stare ' + G2.stare);
  __log.push('clips: ' + ((window.UAP.clips || []).length));
  __log.push('lines (' + R.lines.length + '): ' + R.lines.join(' / '));
  __log.push('RESULT ' + JSON.stringify({ scenes: R.scenes, stall: R.stall, end: vis('endcard') ? document.getElementById('endTitle').textContent : null, lucidity: +G2.lucidity.toFixed(3), trust: G2.trust, path: G2.path, lines: R.lines, clips: (window.UAP.clips || []).length }));
}
