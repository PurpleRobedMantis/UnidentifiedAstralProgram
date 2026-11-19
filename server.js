// Tiny static file server for the game. Run: node server.js
// Tries a few ports (Windows reserves some ranges) and can open the browser itself: node server.js --open
// It only listens on this computer (127.0.0.1) and only serves files inside this folder.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const root = __dirname;
// node server.js --lan also listens on the home network (for phone testing) and accepts private-network addresses.
const LAN = process.argv.includes('--lan');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const envPort = Number(process.env.PORT);
const ports = [...(Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? [envPort] : []), 8765, 8080, 3210, 0];
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
// Requests must name this machine, which stops other web pages reaching the server through DNS rebinding.
const okHost = LAN
  ? /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i
  : /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const baseHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
// Everything the game loads comes from this server; inline <script> blocks (the import map) are allowed by hash.
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function cspFor(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    // the browser turns CRLF and lone CR into LF before it checks the hash, so hash what the browser will see
    if (m[1]) hashes.push(`'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`);
  }
  return `${CSP}; script-src 'self' ${hashes.join(' ')}`.trim();
}

// URL path -> absolute file path inside root, or null if it must not be served.
function resolveFile(urlPath) {
  if (!urlPath.startsWith('/')) return null;            // absolute-form ("http://x/../..") and "*" targets
  let p;
  try { p = decodeURIComponent(urlPath); } catch (_) { return null; }  // malformed %-escapes
  if (p.includes('\0') || p.includes(':')) return null; // null bytes, drive letters, NTFS streams (file::$DATA)
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);                       // normalises both / and \ on Windows
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.split(path.sep).some((s) => s.startsWith('.'))) return null; // dotfiles and dot-folders (.git and the like)
  return file;
}

function send(res, code, headers, body, head) {
  res.writeHead(code, { ...baseHeaders, ...headers });
  res.end(head ? undefined : body);
}

const server = http.createServer((req, res) => {
  try {
    if (!okHost.test(req.headers.host || '')) return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' }, 'Method not allowed');
    const head = req.method === 'HEAD';
    const file = resolveFile(req.url.split('?')[0]);
    if (!file) return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden', head);
    fs.readFile(file, (err, data) => {
      if (err) {
        const missing = err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR' || err.code === 'EINVAL';
        return send(res, missing ? 404 : 500, { 'Content-Type': 'text/plain' }, missing ? 'Not found' : 'Server error', head);
      }
      const ext = path.extname(file).toLowerCase();
      const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': data.length };
      if (ext === '.html') headers['Content-Security-Policy'] = cspFor(data.toString('utf8'));
      send(res, 200, headers, data, head);
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { 'Content-Type': 'text/plain' }, 'Server error');
    else res.destroy();
  }
});

let i = 0;
server.on('error', (err) => {
  if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && i < ports.length - 1) { i++; server.listen(ports[i], HOST); }
  else { console.error('Could not start the server: ' + err.message); process.exit(1); }
});
server.on('listening', () => {
  const url = 'http://localhost:' + server.address().port;
  console.log('Unidentified Astral Program is running at ' + url);
  if (LAN) for (const list of Object.values(require('os').networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log('On your phone (same Wi-Fi): http://' + a.address + ':' + server.address().port);
  console.log('Keep this window open while you play. Close it to stop.');
  // url is a fixed string plus a port number, so nothing from outside reaches the shell here
  if (process.argv.includes('--open')) exec((process.platform === 'win32' ? 'start "" ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + url, () => {});
});
server.listen(ports[0], HOST);
