const fs = require('fs');
const http = require('http');
const path = require('path');
const casesHandler = require('./api/cases');
const contactHandler = require('./api/contact');
const adminCasesHandler = require('./api/admin/cases');
const adminHandler = require('./api/admin');

const rootDirectory = __dirname;
const port = Number(process.env.PORT) || 3000;
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const loadLocalEnvironment = () => {
  const envPath = path.join(rootDirectory, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) return;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  });
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const handleApiRequest = async (req, res, body) => {
  const apiResponse = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    json(payload) {
      sendJson(res, this.statusCode, payload);
      return this;
    },
    send(payload) {
      res.writeHead(this.statusCode);
      res.end(payload);
      return this;
    }
  };
  const apiRequest = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body
  };
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const handler = pathname === '/api/contact'
    ? contactHandler
    : pathname === '/api/cases'
      ? casesHandler
      : pathname === '/api/admin/cases'
        ? adminCasesHandler
    : pathname === '/api/admin'
      ? adminHandler
      : null;

  if (!handler) {
    sendJson(res, 404, { ok: false, message: 'Not found.' });
    return;
  }

  await handler(apiRequest, apiResponse);
};

const serveStaticFile = (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(rootDirectory, `.${pathname}`);
  if (!filePath.startsWith(`${rootDirectory}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(res);
  });
};

if (process.env.SKIP_LOCAL_ENV !== '1') loadLocalEnvironment();

http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 4 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on('end', async () => {
      let body = {};
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON request body.' });
          return;
        }
      }
      try {
        await handleApiRequest(req, res, body);
      } catch (error) {
        console.error('Local API error:', error);
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, message: 'Internal server error.' });
        }
      }
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  serveStaticFile(req, res);
}).listen(port, () => {
  console.log(`Pipe World site running at http://localhost:${port}`);
});
