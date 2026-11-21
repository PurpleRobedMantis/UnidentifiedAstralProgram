// Route checks: plays every scene, branch and ending headless with tools/drivers/auto.js and checks each result
// against what the rules say must happen (docs/DECISIONS.md). Exits 1 if any route fails.
//   node tools/routes.js                 every route, 2 at a time (run from PowerShell: the Bash sandbox cannot reach local ports)
//   node tools/routes.js window          only routes whose name contains "window"
//   node tools/routes.js --changed       only routes that play a file changed since the last run where every route passed
//   node tools/routes.js --for js/scenes/field.js,js/scenes/reveal.js   only routes that play those files
//   --jobs N                             routes run side by side (default 2; 4 is about twice as fast but heavy; 1 = one at a time)
// Each route is one page load of the working copy at fast=8 (UAP_ROOT tests another copy). Game time is stepped by the
// driver (E.manual, 33 ms a step), not real time, so running routes side by side does not change their results.
// A route fails on a wrong result, a stall, a console error or warning, or any CLIP warning. Each result line prints as
// soon as that route ends, with its time, so progress shows while it runs: do not pipe it through Out-String.
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.join(__dirname, '..');
const auto = fs.readFileSync(path.join(__dirname, 'drivers', 'auto.js'), 'utf8');
const near = (a, b) => Math.abs(a - b) < 0.011;
const said = (r, s) => r.lines.some((l) => l.includes(s));
// [name, URL state, driver settings, check(result) -> '' when right, else what is wrong]
const ROUTES = [
  ['bedroom, no input: freeze, fail the stare', 'scene=bedroom', { stop: 'hub', max: 60000 }, (r) => r.path !== 'afraid' ? 'path ' + r.path : !near(r.lucidity, 0.18) ? 'lucidity ' + r.lucidity : ''],
  ['bedroom, fight', 'scene=bedroom', { fight: true, max: 60000 }, (r) => r.end !== 'MISSING TIME' ? 'end ' + r.end : ''],
  ['exam alone: stare fails', 'scene=exam', { stop: 'hub' }, (r) => !near(r.lucidity, 0.3) ? 'lucidity ' + r.lucidity : ''],
  ['classroom: orb', 'scene=room&room=class', { stop: 'hub' }, (r) => !near(r.lucidity, 0.56) ? 'lucidity ' + r.lucidity : ''],
  ['window: alive', 'scene=room&room=window', { stop: 'hub', picks: [1] }, (r) => r.trust !== 1 || !near(r.lucidity, 0.54) ? `trust ${r.trust} lucidity ${r.lucidity}` : ''],
  ['window: why', 'scene=room&room=window', { stop: 'hub', picks: [2] }, (r) => r.trust !== 0 || !near(r.lucidity, 0.5) ? `trust ${r.trust} lucidity ${r.lucidity}` : ''],
  ['window: anything', 'scene=room&room=window', { stop: 'hub', picks: [3] }, (r) => r.trust !== -1 || !near(r.lucidity, 0.46) ? `trust ${r.trust} lucidity ${r.lucidity}` : ''],
  ['containers: take the toy', 'scene=room&room=containers', { stop: 'hub', picks: [1] }, (r) => r.trust !== 1 ? 'trust ' + r.trust : ''],
  ['containers: leave the toy', 'scene=room&room=containers', { stop: 'hub', picks: [2] }, (r) => r.trust !== 0 ? 'trust ' + r.trust : ''],
  ['still room', 'scene=room&room=viewing', { stop: 'hub' }, (r) => !near(r.lucidity, 0.58) ? 'lucidity ' + r.lucidity : ''],
  ['crossroads: greeting after the stare', 'scene=hub&stare=1', { approach: true, max: 2500 }, (r) => !said(r, 'You held our gaze') ? 'no stare greeting' : ''],
  ['crossroads: greeting when afraid', 'scene=hub&path=afraid', { approach: true, max: 2500 }, (r) => !said(r, 'You are afraid') ? 'no afraid greeting' : ''],
  ['crossroads: rude thought costs trust', 'scene=hub', { approach: true, picks: [3], max: 2500 }, (r) => r.trust !== -1 ? 'trust ' + r.trust : ''],
  ['crossroads: no trust, no vision', 'scene=hub&seen=4&asked=1&trust=-2', { approach: true, max: 20000 }, (r) => !said(r, 'You are not ready') || r.end !== 'SCEPTICISM' ? 'end ' + r.end : ''],
  ['crossroads: see more, no', 'scene=hub&seen=4&asked=1', { approach: true, picks: [2], max: 20000 }, (r) => r.end !== 'SCEPTICISM' ? 'end ' + r.end : ''],
  ['council: thank you, lucid and trusting', 'scene=mandala&lucid=0.7&trust=1', { picks: [2], max: 60000 }, (r) => r.end !== 'COMMUNION' ? 'end ' + r.end : ''],
  ['council: thank you, lucid, no trust', 'scene=mandala&lucid=0.7', { picks: [2], max: 60000 }, (r) => r.end !== 'HANG UP THE PHONE' ? 'end ' + r.end : ''],
  ['council: thank you, not lucid', 'scene=mandala&lucid=0.5&trust=4', { picks: [2], max: 60000 }, (r) => r.end !== 'SCEPTICISM' ? 'end ' + r.end : ''],
  ['council: say nothing tips lucidity', 'scene=mandala&lucid=0.5&trust=2', { picks: [4], max: 60000 }, (r) => r.end !== 'COMMUNION' ? 'end ' + r.end : ''],
  ['council: is that all', 'scene=mandala', { picks: [1, 1], max: 60000 }, (r) => r.end !== 'HANG UP THE PHONE' ? 'end ' + r.end : ''],
  ['council: let me past', 'scene=mandala&trust=3', { picks: [3], max: 60000 }, (r) => r.end !== 'THE WARDENS' || r.trust !== 1 ? `end ${r.end} trust ${r.trust}` : ''],
  ['crossroads: see more, yes leads to the control room', 'scene=hub&seen=4&asked=1', { approach: true, picks: [1], stop: 'control', max: 20000 }, (r) => !r.scenes.includes('control') ? 'scenes ' + r.scenes.join(' ') : ''],
  ['control room to the field', 'scene=control', { stop: 'field', max: 60000 }, (r) => !r.scenes.includes('field') ? 'scenes ' + r.scenes.join(' ') : ''],
  ['field to the aftermath', 'scene=field', { stop: 'aftermath', max: 60000 }, (r) => !r.scenes.includes('aftermath') ? 'scenes ' + r.scenes.join(' ') : ''],
  ['aftermath, no toy: straight to the vision', 'scene=aftermath', { stop: 'mandala', max: 40000 }, (r) => r.scenes.includes('reveal') || !r.scenes.includes('mandala') ? 'scenes ' + r.scenes.join(' ') : ''],
  ['aftermath, toy: the reveal', 'scene=aftermath&toy=1', { stop: 'reveal', max: 40000 }, (r) => !r.scenes.includes('reveal') ? 'scenes ' + r.scenes.join(' ') : ''],
  ['reveal: reach for them', 'scene=reveal&toy=1', { picks: [1], stop: 'mandala', max: 60000 }, (r) => r.trust !== 1 || !r.scenes.includes('mandala') ? `trust ${r.trust} scenes ${r.scenes.join(' ')}` : ''],
  ['reveal: step back', 'scene=reveal&toy=1', { picks: [2], stop: 'mandala', max: 60000 }, (r) => r.trust !== -1 ? 'trust ' + r.trust : ''],
  ['reveal: say nothing', 'scene=reveal&toy=1&lucid=0.5', { picks: [3], stop: 'mandala', max: 60000 }, (r) => r.trust !== 0 || !near(r.lucidity, 0.54) ? `trust ${r.trust} lucidity ${r.lucidity}` : ''],
  ...[['missing', 'MISSING TIME'], ['communion', 'COMMUNION'], ['wardens', 'THE WARDENS'], ['phone', 'HANG UP THE PHONE'], ['sceptic', 'SCEPTICISM']]
    .map(([k, t]) => ['ending ' + k, 'scene=end:' + k, {}, (r) => r.end !== t ? 'end ' + r.end : '']),
];
// which files each route plays (by name); a change to any other js file (engine, models, audio, main, ...) runs every route
const PLAYS = [   // first match wins
  [/^bedroom/, ['js/scenes/night.js']], [/^exam/, ['js/scenes/night.js']],
  [/see more, yes/, ['js/scenes/ship.js', 'js/scenes/control.js']],
  [/^(classroom|window|containers|still room|crossroads)/, ['js/scenes/ship.js']],
  [/^(council|ending)/, ['js/scenes/beyond.js', 'js/scenes/ship.js']],
  [/^control room/, ['js/scenes/control.js', 'js/scenes/field.js']],
  [/^field/, ['js/scenes/field.js', 'js/scenes/control.js']],
  [/^aftermath/, ['js/scenes/control.js', 'js/scenes/reveal.js', 'js/scenes/ship.js']],
  [/^reveal/, ['js/scenes/reveal.js', 'js/scenes/beyond.js', 'js/scenes/ship.js']],   // reveal and beyond import ship.js
];
const SCENE_FILES = new Set(PLAYS.flatMap(([, fl]) => fl));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const JOBS = Math.max(1, Number(opt('--jobs')) || 2);   // 2 by default: 4 is faster but loads the CPU and GPU hard
const only = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--jobs', '--for'].includes(args[i - 1])));
const STAMP = path.join(root, 'shots', '.routes-pass');   // touched after a run where every route passed
let files = null;
if (opt('--for')) files = String(opt('--for')).split(',').map((x) => x.trim().split('\\').join('/'));
if (opt('--changed')) {
  const since = fs.existsSync(STAMP) ? fs.statSync(STAMP).mtimeMs : 0;
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'lang' ? [] : walk(d + '/' + e.name)) : (e.name.endsWith('.js') ? [d + '/' + e.name] : []));
  files = walk('js').filter((p) => fs.statSync(path.join(root, p)).mtimeMs > since);
  if (!since) console.log('no earlier full pass recorded: running every route');
  else console.log('changed since the last full pass: ' + (files.join(', ') || 'nothing'));
  if (!files.length) process.exit(0);
}
const wanted = (name) => {
  if (only && !name.includes(only)) return false;
  if (!files) return true;
  if (files.some((p) => !SCENE_FILES.has(p))) return true;   // a shared file changed: everything
  const hit = PLAYS.find(([re]) => re.test(name));
  return !hit || hit[1].some((p) => files.includes(p));
};
const todo = ROUTES.filter(([name]) => wanted(name));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uap-routes-'));
const t0 = Date.now();
let failed = 0, next = 0;
const runOne = (w, [name, q, set, check]) => new Promise((done) => {
  const dir = path.join(tmp, 'w' + w); fs.mkdirSync(dir, { recursive: true });
  const drv = path.join(dir, 'drv.js');
  fs.writeFileSync(drv, 'window.__set = ' + JSON.stringify(set) + ';\n' + auto);
  // each worker has its own server port and Chrome debugging port (and so its own Chrome profile)
  const env = { ...process.env, UAP_PORT: String((Number(process.env.UAP_PORT) || 8780) + w), UAP_DBG: String((Number(process.env.UAP_DBG) || 9350) + w) };
  const ts = Date.now();
  const p = spawn(process.execPath, [path.join(__dirname, 'shot.js'), 'dev=1&fast=8&' + q, path.join(dir, 'shot'), drv], { cwd: root, env });
  let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  const kill = setTimeout(() => { try { p.kill(); } catch (_) {} }, 600000);
  p.on('close', () => {
    clearTimeout(kill);
    const m = out.match(/RESULT (\{.*\})\s*$/m);
    let why = '';
    if (!m) why = 'no result: ' + out.trim().split('\n').slice(-2).join(' ');
    else {
      const r = JSON.parse(m[1]);
      // a stall only matters if the route has no other way to finish; greeting checks end on purpose by running out
      why = check(r) || (r.clips ? r.clips + ' CLIP warnings' : '') || (!/no console errors/.test(out) ? 'console: ' + out.split('console errors/warnings:')[1]?.trim().split('\n')[0] : '');
    }
    if (why) failed++;
    console.log((why ? 'FAIL ' : 'ok   ') + name + ' (' + Math.round((Date.now() - ts) / 1000) + ' s)' + (why ? '  — ' + why : ''));
    done();
  });
});
const worker = async (w) => { while (next < todo.length) await runOne(w, todo[next++]); };
Promise.all(Array.from({ length: Math.min(JOBS, todo.length) }, (_, w) => worker(w))).then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${todo.length - failed}/${todo.length} routes pass in ${Math.round((Date.now() - t0) / 1000)} s (${JOBS} at a time)`);
  if (!failed && todo.length === ROUTES.length && !only) { fs.mkdirSync(path.dirname(STAMP), { recursive: true }); fs.writeFileSync(STAMP, new Date().toISOString()); }
  process.exit(failed ? 1 : 0);
});
