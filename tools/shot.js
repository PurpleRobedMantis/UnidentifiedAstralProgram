// Headless still capture for checking scenes without the browser pane.
// Starts the working copy's server on 8767 (if not already up), launches headless Chrome with remote debugging,
// loads a game URL, runs a driver script in the page, and saves PNG screenshots.
//
//   node tools/shot.js "<query>" <out-prefix> "<driver JS, or a path to a .js file holding it>"
//
// The driver runs in the page after BEGIN is clicked, with E/G available and helpers:
//   await steps(n)            advance n frames of 33 ms (E.manual stepping)
//   await until(fn, max)      step until fn() is true (max frames, default 3000)
//   sub()                     the current subtitle text
//   await snap(name)          save <out-prefix>-<name>.png
//   view(pos, target)         render the following snaps from another camera (arrays or vectors); view(null) goes back
//   around(obj, side, dist, h) close-up of obj from its 'front', '34' (three-quarter), '34L', 'side' or 'back', dist m away
//                             (default 1.4), looking at height h (default 0.6 m up the object: a grey's middle); around(null) goes back
// Anything the driver pushes to window.__log is printed at the end.
// RULES (each cost a failed or hung run before build 142):
//   - The driver is cut at every `await snap(...)`; each stretch runs as its own function. Snaps go at the top level only
//     (never in a loop, if or function: refused before Chrome starts), and a const/let does not carry into the next
//     stretch: share state on window (window.U = {...}).
//   - Each run starts from a fresh browser: localStorage does not survive to the next run. Test stored-settings logic in
//     Node with a stand-in store (shots/b142/reset-node.js), not across two runs.
//   - An iframe of the game never finishes loading headless; don't build tests on one.
//   - A stuck run stops itself after UAP_TIMEOUT seconds (default 420) and says where. UAP_CHECK_ONLY=1 checks a driver
//     without running it.
// Example:
//   node tools/shot.js "dev=1&scene=exam" shots/exam "await until(()=>sub().includes('slides out')); await steps(30); await snap('scanner');"
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');
let [, , query = 'dev=1', prefix = 'shots/shot', driver = 'await steps(60); await snap("a");'] = process.argv;
if (driver.endsWith('.js') && fs.existsSync(driver)) driver = fs.readFileSync(driver, 'utf8');
// Driver check before anything starts (build 142, after drivers failed and hung twice in one task). The driver is cut at
// every `await snap(...)` and each stretch runs as its own function, so (1) a snap inside a loop, block or function breaks
// the stretches apart (checked here), and (2) a const/let from one stretch does not exist in the next: share state on
// window (a stretch that uses one fails at once with "is not defined" and a hint).
{
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const stretches = driver.split(/await snap\([^)]*\);?/);
  stretches.forEach((part, i) => {
    try { new AsyncFunction('E', 'G', part); } catch (e) {
      console.error(`DRIVER ERROR: stretch ${i + 1} (between snaps) does not parse on its own: ${e.message}.\n` +
        'Each await snap(...) must be at the top level of the driver, never inside a loop, if, block or function.');
      process.exit(3);
    }
  });
  if (process.env.UAP_CHECK_ONLY === '1') { console.log('driver ok'); process.exit(0); }   // check a driver without running it
}
// A run that gets stuck is stopped, not left hanging: UAP_TIMEOUT seconds in all (default 420), then Chrome and the
// test server are killed and the stretch it was in is named.
const TIMEOUT = Number(process.env.UAP_TIMEOUT) || 420;
let stretchAt = 'startup';
// UAP_ROOT / UAP_PORT test another copy (e.g. the packaged beta folder) instead of the working copy
const root = process.env.UAP_ROOT ? path.resolve(process.env.UAP_ROOT) : path.join(__dirname, '..');
// UAP_SIZE=1920x1080 captures at another size (default 1280x720); UAP_MOBILE=1 emulates a phone (touch only, mobile viewport)
const [W, H] = (process.env.UAP_SIZE || '1280x720').split('x').map(Number);
const PORT = Number(process.env.UAP_PORT) || 8767, DBG = Number(process.env.UAP_DBG) || 9333;   // UAP_DBG lets two captures run side by side
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));

const get = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url, tries = 40) { for (let i = 0; i < tries; i++) { try { return await get(url); } catch (_) { await sleep(250); } } throw new Error('not up: ' + url); }

(async () => {
  let server = null;
  try { await get(`http://127.0.0.1:${PORT}/index.html`); } catch (_) {
    server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    await up(`http://127.0.0.1:${PORT}/index.html`);
  }
  const prof = path.join(require('os').tmpdir(), 'uap-shot-profile' + (process.env.UAP_DBG || ''));
  // UAP_SOFTWARE=1 renders on the CPU (SwiftShader) to check the "acceleration is off" warning: title screen only, it pins the CPU
  const gpu = process.env.UAP_SOFTWARE === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${prof}`, ...gpu,   // default: render on the graphics card, not the CPU
    `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  const killer = setTimeout(() => {
    console.error(`TIMED OUT after ${TIMEOUT} s in ${stretchAt}. Chrome and the test server stopped. Likely causes: an until() that never comes true, a promise that never settles (an iframe of the game does not finish loading headless), or a step loop too long for the time.`);
    try { chrome.kill(); } catch (_) {} if (server) try { server.kill(); } catch (_) {}
    process.exit(2);
  }, TIMEOUT * 1000);
  try {
    const list = JSON.parse(await up(`http://127.0.0.1:${DBG}/json/list`));
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0; const wait = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
    const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const errs = [];
    ws.addEventListener('message', (m) => { const d = JSON.parse(m.data);
      if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
      if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) errs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
      if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errs.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url || '')); });
    await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Log.enable');
    // UAP_MOBILE=1: a phone (mobile viewport, touch as the only pointer), so the game starts in its touch mode
    const MOBILE = process.env.UAP_MOBILE === '1';
    await cmd('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE });
    if (MOBILE) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/?${query}` });
    // wait until the game is ready (BEGIN exists and, with dev=1, window.UAP), not a fixed time: under load (several
    // captures side by side, tools/routes.js --jobs) a fixed 2.5 s was sometimes too short
    for (let i = 0; i < 300; i++) {
      const r = await cmd('Runtime.evaluate', { expression: `!!document.getElementById('startBtn') && (${!/(^|&)dev=1/.test(query)} || !!window.UAP)`, returnByValue: true });
      if (r.result?.result?.value) break;
      await sleep(100);
    }
    await sleep(300);
    const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) { const t = JSON.stringify(r.result.exceptionDetails); throw new Error(t.slice(0, 600) + (/is not defined/.test(t) ? ' HINT: each stretch between snaps is a separate function, so a const/let from an earlier stretch is gone. Share it on window (window.U = {...}).' : '')); } return r.result.result.value; };
    // without dev mode there is no window.UAP: the driver then gets only the page (E and G undefined)
    await ev(`(async()=>{ if(!window.UAP) return 0; const {E}=window.UAP; E.manual=true; E.wantLock=false; window.__ms=performance.now(); document.getElementById('startBtn').click();
      window.steps=async(n)=>{ E.noRender=true; for(let i=0;i<n;i++){ window.__ms+=33; E.step(window.__ms); if(i%30===0) await new Promise(r=>setTimeout(r,0)); } };
      window.sub=()=>document.getElementById('sub').textContent;
      window.until=async(fn,max=3000)=>{ for(let i=0;i<max;i++){ if(fn()) return true; await window.steps(1); } return false; };
      window.__snaps=[]; window.snap=async(n)=>{ E.noRender=false; document.getElementById('fade').style.opacity=0; window.__ms+=33; E.step(window.__ms); window.__snaps.push(n); await new Promise(r=>setTimeout(r,60)); };
      window.view=(pos,target)=>{ const r=E.renderer; if(!r.__vw){ const o=r.render.bind(r); r.render=(sc,cam)=>{ const v=window.__view; if(!v) return o(sc,cam); const a=cam.position.clone(), q=cam.quaternion.clone(); cam.position.set(v[0][0],v[0][1],v[0][2]); cam.lookAt(v[1][0],v[1][1],v[1][2]); cam.updateMatrixWorld(); o(sc,cam); cam.position.copy(a); cam.quaternion.copy(q); cam.updateMatrixWorld(); }; r.__vw=1; } window.__view = pos ? [pos.toArray ? pos.toArray() : pos, target.toArray ? target.toArray() : target] : null; };
      window.around=(obj,side,dist,h)=>{ if(!obj){ window.view(null); return; } dist=dist||1.4; const a={front:0,'34':Math.PI/4,side:Math.PI/2,back:Math.PI,'34L':-Math.PI/4}[side||'front']; obj.updateMatrixWorld(true); const t=obj.localToWorld(new E.camera.position.constructor(0,0,0)); if(h!=null) t.y=h; else t.y+=0.6*(obj.scale.y||1); const e=obj.matrixWorld.elements, fx=e[8], fz=e[10], L=Math.hypot(fx,fz)||1, c=Math.cos(a), s2=Math.sin(a), dx=(fx*c+fz*s2)/L, dz=(fz*c-fx*s2)/L; window.view([t.x+dx*dist,t.y+0.1,t.z+dz*dist],[t.x,t.y,t.z]); };
      return 1; })()`);
    // the driver runs in chunks so each snap can be captured from outside
    const parts = driver.split(/(await snap\([^)]*\);?)/);
    fs.mkdirSync(path.dirname(path.resolve(root, prefix)), { recursive: true });
    let nStretch = 0;
    for (const p of parts) {
      if (!p.trim()) continue;
      stretchAt = /^await snap/.test(p) ? 'a snap' : `driver stretch ${++nStretch}`;
      const m = p.match(/^await snap\(\s*['"]([^'"]+)['"]\s*\);?$/);
      if (m) {
        await ev(`(async()=>{ await snap(${JSON.stringify(m[1])}); return 1; })()`);
        const shot = await cmd('Page.captureScreenshot', { format: 'png' });
        const out = path.resolve(root, `${prefix}-${m[1]}.png`); fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('saved', out);
      } else await ev(`(async()=>{ const {E,G}=window.UAP||{}; ${p}; return 1; })()`);
    }
    const log = await ev(`(window.__log||[]).join(' | ')`); if (log) console.log(log);
    if (errs.length) console.log('console errors/warnings:\n' + errs.join('\n')); else console.log('no console errors');
    ws.close();
  } finally { clearTimeout(killer); chrome.kill(); if (server) server.kill(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
