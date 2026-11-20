// Builds the public copy from an allowlist and excludes local assistant files,
// including assistant instructions placed inside an otherwise shippable directory.
//
//   node tools/release.js [out-folder]      default builds/beta (the zip goes next to it, in builds/)
//
// Everything is built in a staging folder next to the out folder, scanned for local paths and private details, and
// zipped there. Only when all of that passes does the staging folder replace the out folder and the zip replace the old
// one, so a rejected or failed build leaves the previous beta folder and zip exactly as they were.
// The out folder is only ever replaced if it is empty or was made by this script.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'builds', 'beta'));
const MARK = '.uap-release';

const FILES = ['index.html', 'LICENSE', 'README.md', 'server.js', 'start.bat', 'package.json',
  'vendor/three/LICENSE', 'vendor/three/three.module.js', 'docs/RESEARCH.md', 'docs/GAME_DESIGN.md'];
const DIRS = { js: /\.(js|txt|json)$/, 'js/scenes': /\.js$/, 'js/clips': /\.js$/, 'js/lang': /\.js$/, img: /\.(jpg|png)$/ };
const localOnly = /(?:^|\/)(?:\.(?:claude|codex|agents)(?:\/|$)|(?:claude|codex|agents)\.md$)|^docs\/[^/]*audit[^/]*\.md$/i;

if (fs.existsSync(out)) {
  const left = fs.readdirSync(out);
  if (left.length && !left.includes(MARK)) throw new Error(out + ' exists and was not made by this script; not touching it');
}
const stage = out + '.staging';
fs.rmSync(stage, { recursive: true, force: true });
const fail = (msg) => { try { fs.rmSync(stage, { recursive: true, force: true }); } catch (_) {} console.error(msg + '\nNothing replaced: the previous beta folder and zip are unchanged.'); process.exit(1); };
const copy = (rel) => {
  if (localOnly.test(rel)) return;
  const to = path.join(stage, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(root, rel), to);
};
FILES.forEach(copy);
for (const [d, re] of Object.entries(DIRS)) {
  for (const entry of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    if (entry.isFile() && re.test(entry.name)) copy(d + '/' + entry.name);
  }
}
fs.writeFileSync(path.join(stage, MARK), 'made by tools/release.js\n');

// safety scan: nothing private or machine-specific in the text files
// Generic patterns live here; personal words (names, email, handles) go one per line in tools/private-words.txt,
// which .gitignore keeps out of the repository so this public script never names anyone.
const privFile = path.join(__dirname, 'private-words.txt');
const priv = fs.existsSync(privFile) ? fs.readFileSync(privFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : [];
if (!priv.length) console.warn('note: tools/private-words.txt is missing or empty, so only generic patterns are checked');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BAD = new RegExp([...priv.map(esc), '[a-z0-9._%+-]+@[a-z0-9-]+\\.[a-z.]{2,}', '192\\.168\\.', '[a-z]:[\\\\/]users[\\\\/]', '/c/users/', 'appdata', 'localappdata',
  'onedrive', 'claude\\.md', 'handoff\\.md'].join('|'), 'i');
const hits = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!/\.(js|html|md|txt|json|bat)$/.test(e.name) || e.name === 'three.module.js') return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => { if (BAD.test(l)) hits.push(path.relative(out, p) + ':' + (i + 1) + '  ' + l.trim().slice(0, 120)); });
});
walk(stage);
let n = 0, bytes = 0;
const count = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) count(p); else { n++; bytes += fs.statSync(p).size; } });
count(stage);
console.log(`${out}: ${n} files, ${(bytes / 1048576).toFixed(1)} MB`);
if (hits.length) fail('PRIVATE OR LOCAL DETAILS FOUND:\n' + hits.join('\n'));
console.log('scan clean');

// zip for itch.io (index.html at the root, forward-slash paths), named after the build: builds/UnidentifiedAstralProgram-build-N.zip
// Windows' own tar.exe (bsdtar) writes real zips; PowerShell's Compress-Archive writes backslash paths that break on itch.
const build = (fs.readFileSync(path.join(stage, 'index.html'), 'utf8').match(/id="build"[^>]*>[^<]*\bbuild (\d+)</) || [])[1] || 'x';
const zip = path.join(path.dirname(out), `UnidentifiedAstralProgram-build-${build}.zip`);
const tar = fs.existsSync('C:/Windows/System32/tar.exe') ? 'C:/Windows/System32/tar.exe' : 'tar';
// Written to a temporary zip first (tar picks the format from the .zip ending) and checked; only then does it replace
// the real one and are older build zips removed, so a failed or interrupted write never costs the last good build.
const tmp = path.join(path.dirname(out), `.partial-${path.basename(zip)}`);
const cp = require('child_process');
try {
  fs.rmSync(tmp, { force: true });
  cp.execFileSync(tar, ['-a', '-c', '-f', tmp, '-C', stage, ...fs.readdirSync(stage).filter((f) => f !== MARK)]);
  const listed = cp.execFileSync(tar, ['-t', '-f', tmp], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  if (!listed.includes('index.html') || listed.length < n - 1) throw new Error(`zip check failed: ${listed.length} entries, expected ${n - 1} with index.html at the root`);
} catch (err) {
  try { fs.rmSync(tmp, { force: true }); } catch (_) {}
  fail('ZIP NOT WRITTEN: ' + err.message);
}
// promote: the checked folder replaces the old one, then the checked zip replaces the old zip
fs.rmSync(out, { recursive: true, force: true });
fs.renameSync(stage, out);
fs.renameSync(tmp, zip);
// only the current build's zip is kept, so an old one is never uploaded by mistake (they are all made by this script)
for (const f of fs.readdirSync(path.dirname(out))) if (/^UnidentifiedAstralProgram-build-.+\.zip$/.test(f) && f !== path.basename(zip)) fs.rmSync(path.join(path.dirname(out), f));
console.log(`${zip}: ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);
