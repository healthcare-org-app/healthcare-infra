/**
 * Stateful stand-in for patients-service (GET/PATCH /api/patients/{id}), forked from hc-patients.
 * Same routes, record shape and error shape as the gateway; unlike hc-patients it keeps records, so a
 * PATCH is visible to a later GET. PATCH merges top-level keys like the gateway's JSONB `data` merge.
 * Test controls (not part of the real API): POST /__reset, GET /__calls (every non-control request).
 */
const http = require('http');
const PORT = process.env.PORT || 4171;
const P = 'hc-patients-stateful:';

const SEED = () => ({
  1: { id: 1, status: 'active', created_at: '2026-01-15T09:30:00.000Z', updated_at: '2026-01-15T09:30:00.000Z',
       first_name: 'Jane', last_name: 'Doe', dob: '1985-04-12', mrn: 'MRN-100234',
       email: 'jane.doe@example.com', phone: '555-0142', blood_type: 'O+', identity_sub: 'auth0|jane-doe' },
  2: { id: 2, status: 'active', created_at: '2026-01-15T09:30:00.000Z', updated_at: '2026-01-15T09:30:00.000Z',
       first_name: 'Marcus', last_name: 'Rivera', dob: '1990-09-03', mrn: 'MRN-100235',
       email: 'marcus.rivera@example.com', phone: '555-0187', blood_type: 'A-', identity_sub: 'auth0|marcus-rivera' },
});

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function patients() {
  let all = await pm.state.get(P + 'patients');
  if (!all) { all = SEED(); await pm.state.set(P + 'patients', all); }
  return all;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/__reset') {
    await pm.state.set(P + 'patients', SEED());
    await pm.state.set(P + 'calls', []);
    return send(res, 200, { reset: true });
  }
  if (req.method === 'GET' && pathname === '/__calls') {
    return send(res, 200, { calls: (await pm.state.get(P + 'calls')) || [] });
  }

  const calls = (await pm.state.get(P + 'calls')) || [];
  calls.push({ method: req.method, path: pathname });
  await pm.state.set(P + 'calls', calls);

  const auth = req.headers['authorization'] || '';
  if (!/^bearer\s+\S+/i.test(auth)) {
    return send(res, 401, { error: { code: 'unauthorized', message: 'missing bearer token' } });
  }

  // @endpoint GET /api/patients/:id
  // @endpoint PATCH /api/patients/:id
  const m = /^\/api\/patients\/([^/]+)$/.exec(pathname);
  if (m && (req.method === 'GET' || req.method === 'PATCH')) {
    const id = Number(m[1]);
    if (!Number.isFinite(id)) {
      return send(res, 400, { error: { code: 'bad_id', message: `id must be numeric, got "${m[1]}"` } });
    }
    const all = await patients();
    const row = all[id];
    if (!row) return send(res, 404, { error: { code: 'not_found', message: `no patients with id ${id}` } });
    if (req.method === 'GET') return send(res, 200, row);
    const body = await readBody(req);
    const next = Object.assign({}, row, body, { id: row.id, updated_at: new Date().toISOString() });
    all[id] = next;
    await pm.state.set(P + 'patients', all);
    return send(res, 200, next);
  }

  // 501, not 404: a 404 reads to the caller like a real "not found".
  return send(res, 501, { error: { code: 'not_modelled', message: `${req.method} ${pathname} is not modelled by hc-patients-stateful` } });
});

server.listen(PORT);
