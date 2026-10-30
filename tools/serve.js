/* 本地预览服务器：node tools/serve.js [端口]
   仅用于开发预览；这份简历本身是纯静态的，双击 index.html 也能直接用。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = fs.realpathSync(path.resolve(__dirname, '..'));
const portInput = process.argv[2] ?? process.env.PORT ?? '5178';
const PORT = Number(portInput);
if (!/^\d+$/.test(portInput) || !Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('无效端口: ' + JSON.stringify(portInput) + '（请输入 1–65535 的整数）');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

function inRoot(file) {
  const relative = path.relative(ROOT, file);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

const server = http.createServer(function (req, res) {
  const started = Date.now();
  res.on('finish', function () {
    // Quote the request target so control characters cannot forge log lines.
    console.log(res.statusCode + ' ' + req.method + ' ' + JSON.stringify(req.url) + ' ' + (Date.now() - started) + 'ms');
  });

  function send(code, body) {
    res.writeHead(code, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(405, 'method not allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    return send(400, 'bad request');
  }
  if (pathname.includes('\0')) return send(400, 'bad request');

  const candidate = path.resolve(ROOT, pathname.replace(/^[/\\]+/, ''));
  if (!inRoot(candidate)) return send(403, 'forbidden');

  async function serve() {
    // Check real paths too: a symlink or Windows junction can otherwise escape ROOT.
    let file = await fs.promises.realpath(candidate);
    if (!inRoot(file)) return send(403, 'forbidden');
    let stat = await fs.promises.stat(file);
    if (stat.isDirectory()) {
      file = await fs.promises.realpath(path.join(file, 'index.html'));
      if (!inRoot(file)) return send(403, 'forbidden');
      stat = await fs.promises.stat(file);
    }
    if (!stat.isFile()) return send(404, 'not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', function () { res.destroy(); });
    res.on('close', function () { stream.destroy(); });
    stream.pipe(res);
  }
  serve().catch(function (error) {
    if (res.headersSent) return res.destroy();
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return send(404, 'not found');
    if (error.code === 'EACCES' || error.code === 'EPERM') return send(403, 'forbidden');
    send(500, 'internal server error');
  });
});

server.on('error', function (error) {
  if (error.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，请换一个：node tools/serve.js <其他端口>');
  } else {
    console.error('预览服务器启动失败: ' + error.message);
  }
  process.exitCode = 1;
});
server.listen(PORT, '127.0.0.1', function () {
  console.log('serving ' + ROOT + ' at http://127.0.0.1:' + PORT + '/');
});
