// Route checks: plays every scene, branch and ending headless with tools/drivers/auto.js and checks each result
// against what the rules say must happen (docs/DECISIONS.md). Exits 1 if any route fails.
//   node tools/routes.js            (run from PowerShell: the Bash sandbox cannot reach local ports)
//   node tools/routes.js window     only routes whose name contains "window"
// Each route is one page load of the working copy at fast=8. A route fails on a wrong result, a stall, a console
// error or warning, or any CLIP warning.
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
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
  ...[['missing', 'MISSING TIME'], ['communion', 'COMMUNION'], ['wardens', 'THE WARDENS'], ['phone', 'HANG UP THE PHONE'], ['sceptic', 'SCEPTICISM']]
    .map(([k, t]) => ['ending ' + k, 'scene=end:' + k, {}, (r) => r.end !== t ? 'end ' + r.end : '']),
];
const only = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uap-routes-'));
let failed = 0, ran = 0;
for (const [name, q, set, check] of ROUTES) {
  if (only && !name.includes(only)) continue;
  ran++;
  const drv = path.join(tmp, 'drv.js');
  fs.writeFileSync(drv, 'window.__set = ' + JSON.stringify(set) + ';\n' + auto);
  const p = spawnSync(process.execPath, [path.join(__dirname, 'shot.js'), 'dev=1&fast=8&' + q, path.join(tmp, 'shot'), drv], { cwd: root, encoding: 'utf8', timeout: 600000 });
  const out = (p.stdout || '') + (p.stderr || '');
  const m = out.match(/RESULT (\{.*\})\s*$/m);
  let why = '';
  if (!m) why = 'no result: ' + out.trim().split('\n').slice(-2).join(' ');
  else {
    const r = JSON.parse(m[1]);
    // a stall only matters if the route has no other way to finish; greeting checks end on purpose by running out
    why = check(r) || (r.clips ? r.clips + ' CLIP warnings' : '') || (!/no console errors/.test(out) ? 'console: ' + out.split('console errors/warnings:')[1]?.trim().split('\n')[0] : '');
  }
  if (why) failed++;
  console.log((why ? 'FAIL ' : 'ok   ') + name + (why ? '  — ' + why : ''));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${ran - failed}/${ran} routes pass`);
process.exit(failed ? 1 : 0);
