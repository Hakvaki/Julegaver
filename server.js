'use strict';

const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./src/db');
const { createRouter, readBody, sendJson, serveStatic, HttpError } = require('./src/http');
const { registerRoutes } = require('./src/api');
const { getSessionUser, parseCookies, SESSION_COOKIE } = require('./src/auth');

const PUBLIC_DIR = path.join(__dirname, 'public');

function createApp(dbPath) {
  const db = openDb(dbPath);
  const router = createRouter();
  registerRoutes(router, db);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        const match = router.match(req.method, pathname);
        if (!match) throw new HttpError(404, 'Fant ikke endepunkt');
        const cookies = parseCookies(req);
        const ctx = {
          db,
          params: match.params,
          cookies,
          user: getSessionUser(db, cookies[SESSION_COOKIE]),
          body: {},
        };
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          ctx.body = await readBody(req);
        }
        await match.handler(req, res, ctx);
      } else if (req.method === 'GET') {
        serveStatic(req, res, PUBLIC_DIR, pathname);
      } else {
        throw new HttpError(405, 'Metode ikke støttet');
      }
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendJson(res, err.status, { error: err.message });
      } else {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { error: 'Intern serverfeil' });
      }
    }
  });

  return { server, db };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'julegaver.db');
  const { server } = createApp(dbPath);
  server.listen(port, host, () => {
    console.log(`🎄 Julegaver kjører på http://${host}:${port}`);
  });
}

module.exports = { createApp };
