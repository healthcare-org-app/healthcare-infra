/**
 * Stateful stand-in for notifications-service's dispatch route, POST /api/notifications/send
 * (frontend/api/notifications/send.ts), forked from hc-notifications, which only models CRUD.
 * Like the real route it does NOT de-duplicate: two sends are two delivered notifications.
 * Test controls (not part of the real API):
 *   POST /__reset                        clear delivered notifications, attempt count and any armed failure
 *   POST /__fail {"remaining":N,"status":503}   reject the next N sends with that status, then recover
 *   GET  /__calls                        {attempts, delivered[]}; attempts counts rejected sends too
 */
const http = require('http');
const PORT = process.env.PORT || 4133;
const P = 'hc-notifications-stateful:';
const CHANNELS = ['email', 'sms', 'push'];

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/__reset') {
    await pm.state.set(P + 'delivered', []);
    await pm.state.set(P + 'attempts', 0);
    await pm.state.set(P + 'fail', { remaining: 0, status: 503 });
    return send(res, 200, { reset: true });
  }
  if (req.method === 'POST' && pathname === '/__fail') {
    const b = await readBody(req);
    await pm.state.set(P + 'fail', { remaining: Number(b.remaining) || 0, status: Number(b.status) || 503 });
    return send(res, 200, await pm.state.get(P + 'fail'));
  }
  if (req.method === 'GET' && pathname === '/__calls') {
    return send(res, 200, {
      attempts: (await pm.state.get(P + 'attempts')) || 0,
      delivered: (await pm.state.get(P + 'delivered')) || [],
    });
  }

  // @endpoint POST /api/notifications/send
  if (req.method === 'POST' && pathname === '/api/notifications/send') {
    await pm.state.set(P + 'attempts', ((await pm.state.get(P + 'attempts')) || 0) + 1);

    const auth = req.headers['authorization'] || '';
    if (!/^bearer\s+\S+/i.test(auth)) {
      return send(res, 401, { error: { code: 'unauthorized', message: 'missing bearer token' } });
    }
    const fail = (await pm.state.get(P + 'fail')) || { remaining: 0, status: 503 };
    if (fail.remaining > 0) {
      await pm.state.set(P + 'fail', { remaining: fail.remaining - 1, status: fail.status });
      return send(res, fail.status, { error: { code: 'unavailable', message: 'notification provider unavailable' } });
    }
    const b = await readBody(req);
    if (!b.to || !b.channel) {
      return send(res, 400, { error: { code: 'bad_body', message: "'to' and 'channel' are required" } });
    }
    if (!CHANNELS.includes(String(b.channel))) {
      return send(res, 400, { error: { code: 'bad_channel', message: `'channel' must be one of: ${CHANNELS.join(', ')}` } });
    }
    const delivered = (await pm.state.get(P + 'delivered')) || [];
    const row = {
      id: delivered.length + 1, status: 'queued', created_at: new Date().toISOString(),
      to: b.to, channel: b.channel, subject: b.subject || null, body: b.body || null,
      idempotency_key: req.headers['idempotency-key'] || null,
    };
    delivered.push(row);
    await pm.state.set(P + 'delivered', delivered);
    return send(res, 202, row);
  }

  return send(res, 501, { error: { code: 'not_modelled', message: `${req.method} ${pathname} is not modelled by hc-notifications-stateful` } });
});

server.listen(PORT);
