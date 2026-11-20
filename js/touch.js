// Touch controls for phones and tablets. Nothing here runs until the first touch, so desktop play is unchanged.
// Drag anywhere to look. A stick appears bottom-left when you can walk. Buttons bottom-right stand in for the keys.
import { E, $, setPause, toggleNotes, DEV, t } from './engine.js';

let on = false;
const css = `
  .tc { position: fixed; z-index: 3; user-select: none; -webkit-user-select: none; touch-action: none; }
  .tc.btnT { display: none; align-items: center; justify-content: center; border: 1px solid #cfe6ff88; border-radius: 50%; background: #0a0d1466;
    color: #dfe9ff; font: 12px Arial, sans-serif; letter-spacing: .08em; text-align: center; }
  .tc.btnT.down { background: #cfe6ff44; }
  .tc.btnT.nudge { animation: tcNudge .8s ease-in-out infinite; }
  @keyframes tcNudge { 50% { box-shadow: 0 0 0 5px #cfe6ff55, 0 0 22px #cfe6ff; background: #2a3a5599; } }
  #tcStick { left: 22px; bottom: 26px; width: 120px; height: 120px; border: 1px solid #cfe6ff55; border-radius: 50%; background: #0a0d1444; display: none; }
  #tcStick i { position: absolute; left: 40px; top: 40px; width: 40px; height: 40px; border-radius: 50%; background: #cfe6ff66; }
  #tcAct { right: 26px; bottom: 34px; width: 84px; height: 84px; }
  #tcSpace { right: 26px; bottom: 34px; width: 92px; height: 92px; }
  #tcShift { right: 136px; bottom: 34px; width: 92px; height: 92px; }
  #tcPause { right: 14px; top: 12px; width: 44px; height: 44px; font-size: 15px; }
  #tcNotes { right: 68px; top: 12px; width: 44px; height: 44px; font-size: 10px; }
  #tcFocus { right: 26px; bottom: 34px; width: 96px; height: 96px; }
  #tcDev { left: 12px; top: 12px; width: 44px; height: 44px; font-size: 10px; color: #e0a83a; border-color: #e0a83a88; }
  body.touch #toast { top: 66px; }
  body.touch #choices button { padding: 14px 22px; font-size: 17px; }
  body.touch #hint { bottom: 3%; }
`;

function build() {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.body.classList.add('touch');
  const mk = (id, text, cls = 'btnT') => { const d = document.createElement('div'); d.id = id; d.className = 'tc ' + cls; d.textContent = t(text); document.body.appendChild(d); return d; };
  const stick = mk('tcStick', '', ''), knob = document.createElement('i'); stick.appendChild(knob);
  const act = mk('tcAct', 'ACT'), space = mk('tcSpace', 'STRUGGLE'), shift = mk('tcShift', 'BREATHE'), pause = mk('tcPause', 'II'), notes = mk('tcNotes', 'NOTES'), focus = mk('tcFocus', 'FOCUS');

  // look: any touch that starts on the game view
  const looks = new Map();
  const view = $('view');
  view.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) looks.set(t.identifier, [t.clientX, t.clientY]); e.preventDefault(); }, { passive: false });
  view.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      const p = looks.get(t.identifier); if (!p) continue;
      if (!E.paused) E.look((t.clientX - p[0]) * 0.0052, (t.clientY - p[1]) * 0.0052);
      p[0] = t.clientX; p[1] = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  const endLook = (e) => { for (const t of e.changedTouches) looks.delete(t.identifier); };
  view.addEventListener('touchend', endLook); view.addEventListener('touchcancel', endLook);

  // walk stick
  // pushed right up to the top edge it runs (SHIFT + W on a keyboard)
  const setKeys = (x, y) => { E.keys.KeyW = y < -0.3; E.keys.KeyS = y > 0.3; E.keys.KeyA = x < -0.3; E.keys.KeyD = x > 0.3; E.keys.ShiftLeft = y < -0.85; };
  const stickMove = (e) => {
    const t = e.changedTouches[0], r = stick.getBoundingClientRect();
    let x = (t.clientX - r.left - 60) / 50, y = (t.clientY - r.top - 60) / 50; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`; setKeys(x, y); e.preventDefault();
  };
  stick.addEventListener('touchstart', stickMove, { passive: false }); stick.addEventListener('touchmove', stickMove, { passive: false });
  const stickEnd = () => { knob.style.transform = ''; setKeys(0, 0); };
  stick.addEventListener('touchend', stickEnd); stick.addEventListener('touchcancel', stickEnd);

  // buttons: tap = the key pressed once; hold = the key held
  const key = (el, code, hold) => {
    el.addEventListener('touchstart', (e) => { el.classList.add('down'); E.just.add(code); if (hold) E.keys[code] = true; e.preventDefault(); }, { passive: false });
    const up = () => { el.classList.remove('down'); if (hold) E.keys[code] = false; };
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  };
  key(act, 'KeyE'); key(space, 'Space'); key(shift, 'ShiftLeft', true);
  // FOCUS: hold while something drags your eyes away; the drag weakens and the view eases back to where it should be
  focus.addEventListener('touchstart', (e) => { focus.classList.add('down'); E.steady = true; e.preventDefault(); }, { passive: false });
  const focusUp = () => { focus.classList.remove('down'); E.steady = false; };
  focus.addEventListener('touchend', focusUp); focus.addEventListener('touchcancel', focusUp);
  // developer menu: the same as pressing F2 (only in developer mode)
  if (DEV) { const dev = mk('tcDev', 'DEV'); dev.style.display = 'flex'; dev.addEventListener('touchstart', (e) => { dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' })); e.preventDefault(); }, { passive: false }); }
  pause.addEventListener('touchstart', (e) => { setPause(!E.paused); e.preventDefault(); }, { passive: false });
  notes.addEventListener('touchstart', (e) => { const open = $('notes').style.display === 'block'; if (!open && !E.paused) setPause(true); toggleNotes(!open); e.preventDefault(); }, { passive: false });
  $('notes').addEventListener('click', (e) => { if (e.target === $('notes')) toggleNotes(false); });

  // pause, focus loss or a developer jump: let go of everything (engine.js releaseInput has already cleared E.keys and E.steady)
  addEventListener('uap-release', () => {
    looks.clear(); knob.style.transform = '';
    for (const el of [act, space, shift, focus]) el.classList.remove('down');
  });
  // show only what the moment needs
  E.sys.add(() => {
    const playing = $('title').style.display === 'none' && $('endcard').style.display !== 'block';
    const breathing = !!E.breathing;
    stick.style.display = playing && E.mode === 'walk' ? 'block' : 'none';
    space.style.display = shift.style.display = playing && breathing ? 'flex' : 'none';
    shift.classList.toggle('nudge', !!(breathing && E.nudge && E.nudge.breathe)); space.classList.toggle('nudge', !!(breathing && E.nudge && E.nudge.struggle));
    focus.style.display = playing && E.gazeAt && !E.paused ? 'flex' : 'none'; if (!E.gazeAt) E.steady = false;
    act.style.display = playing && E.canAct && !E.paused && !E.gazeAt && !breathing ? 'flex' : 'none';
    pause.style.display = notes.style.display = playing && $('notes').style.display !== 'block' ? 'flex' : 'none';
  });
  const keys = document.querySelector('#title .keys');
  if (keys) keys.innerHTML = t('DRAG to look') + ' &nbsp;·&nbsp; ' + t('left STICK to walk, push it to the edge to run') + ' &nbsp;·&nbsp; ' + t('buttons appear when there is something to do') + '<br>' + t('Turn your phone sideways. Headphones on.');
  // the menus' keyboard lines, said for a touchscreen
  const set = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = t(text); };
  set('#pauseKeys', 'Tap anywhere else to continue');
  { const c = document.querySelector('#pauseCtl'); if (c) c.style.display = 'none'; }
  set('#notes small', 'Everything you witness is drawn from a report. Each note says whose, and how well it is sourced. Tap CLOSE to go back.');
  set('#credits small', 'Tap CLOSE to go back.');
}

export function initTouch() {
  const start = () => {
    if (on) return; on = true;
    E.wantLock = false; E.touch = true;
    build();
  };
  addEventListener('touchstart', start, { passive: true, capture: true });
  // a phone or tablet (touch is its main pointer) gets the touch controls and touch wording from the start, so the title
  // screen never shows the keyboard help on it; a laptop with a touchscreen still waits for its first touch
  let phone = false;
  try { phone = navigator.maxTouchPoints > 0 && matchMedia('(pointer:coarse)').matches && !matchMedia('(any-pointer:fine)').matches; } catch (_) {}
  if (phone) start();
}
