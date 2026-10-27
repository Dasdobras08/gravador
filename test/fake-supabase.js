// Supabase falso em memória, só para testar a integração do servidor (cabeçalhos, mapeamento, filtros).
// NÃO prova o RLS real: isso é coberto por supabase/tests/run.sh em Postgres de verdade.
import http from 'node:http';

export const ANON = 'anon-key', SERVICE = 'service-key';

export async function startFakeSupabase() {
  const users = new Map(); // token -> { id, email }
  const meetings = []; const objects = new Map(); const calls = []; const quotas = new Map(); const accounts = new Map();
  const state = { users, meetings, objects, calls, quotas, accounts };

  const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    const isService = bearer === SERVICE;
    const user = users.get(bearer);
    const raw = await readBody(req);
    const json = () => (raw.length ? JSON.parse(raw.toString()) : {});
    calls.push({ method: req.method, path: url.pathname, bearer, apikey: req.headers.apikey });

    // ---- Auth
    if (url.pathname === '/auth/v1/user') return user ? send(res, 200, user) : send(res, 401, { error: 'bad jwt' });
    if (url.pathname === '/auth/v1/signup') {
      const b = json();
      if (accounts.has(b.email)) return send(res, 422, { error_code: 'user_already_exists' });
      accounts.set(b.email, b.password);
      return send(res, 200, { user: { id: 'u-' + b.email, email: b.email } }); // sem sessão: exige confirmação
    }
    if (url.pathname === '/auth/v1/token') {
      const b = json();
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        return b.refresh_token === 'refresh-ok' ? send(res, 200, { access_token: 'tok-A', refresh_token: 'refresh-ok', expires_at: 9999999999, user: users.get('tok-A') }) : send(res, 400, { error_code: 'refresh_token_not_found' });
      }
      if (accounts.get(b.email) !== b.password) return send(res, 400, { error_code: 'invalid_credentials' });
      return send(res, 200, { access_token: 'tok-A', refresh_token: 'refresh-ok', expires_at: 9999999999, user: users.get('tok-A') });
    }
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});

    // ---- Storage
    const st = /^\/storage\/v1\/object\/(?:authenticated\/)?audio\/(.+)$/.exec(url.pathname);
    if (st) {
      const p = decodeURIComponent(st[1]);
      const owner = p.split('/')[0];
      if (!isService && !(user && user.id === owner)) return send(res, 403, { message: 'denied' });
      if (req.method === 'POST') { objects.set(p, raw); return send(res, 200, { Key: p }); }
      if (req.method === 'DELETE') { objects.delete(p); return send(res, 200, {}); }
      if (req.method === 'GET') {
        const o = objects.get(p); if (!o) return send(res, 404, { message: 'Object not found' });
        const r = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
        if (r) return send(res, 206, o.subarray(Number(r[1]), Number(r[2]) + 1), { 'Content-Range': `bytes ${r[1]}-${r[2]}/${o.length}` });
        return send(res, 200, o);
      }
    }

    // ---- RPC
    if (url.pathname === '/rest/v1/rpc/my_quota') {
      if (!user) return send(res, 401, {});
      return send(res, 200, quotas.get(user.id) ?? { plan_id: 'teste', plan_name: 'Teste gratuito', status: 'trialing', period_end: new Date(Date.now() + 7 * 864e5).toISOString(), active: true, can_process: true, plan_seconds_remaining: 1200, extra_seconds: 0 });
    }
    if (url.pathname === '/rest/v1/rpc/consume_seconds') {
      if (!isService) return send(res, 403, { message: 'permission denied' });
      state.consumed = [...(state.consumed || []), json()];
      return send(res, 200, {});
    }

    // ---- PostgREST: meetings (simula o RLS: usuário só vê o que é dele)
    if (url.pathname === '/rest/v1/meetings') {
      if (!isService && !user) return send(res, 401, {});
      const visible = () => meetings.filter((m) => isService || m.user_id === user.id);
      const id = /^eq\.(.+)$/.exec(url.searchParams.get('id') || '')?.[1];
      const statuses = /^in\.\((.+)\)$/.exec(url.searchParams.get('status') || '')?.[1]?.split(',');
      const match = () => visible().filter((m) => (!id || m.id === id) && (!statuses || statuses.includes(m.status)));
      if (req.method === 'GET') return send(res, 200, match().sort((a, b) => b.created_at.localeCompare(a.created_at)));
      if (req.method === 'POST') {
        const b = json();
        if (b.user_id && !isService && b.user_id !== user.id) return send(res, 403, { code: '42501' });
        const row = { id: crypto.randomUUID(), user_id: user?.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), demo: false, error: null, failed_stage: null, transcript: null, result: null, ...b };
        meetings.push(row); return send(res, 201, [row]);
      }
      if (req.method === 'PATCH') { const rows = match(); rows.forEach((r) => Object.assign(r, json())); return send(res, 200, rows); }
      if (req.method === 'DELETE') { const rows = match(); rows.forEach((r) => meetings.splice(meetings.indexOf(r), 1)); return send(res, 204); }
    }
    send(res, 404, { message: 'rota não simulada: ' + url.pathname });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  users.set('tok-A', { id: 'user-a', email: 'a@x.com' });
  users.set('tok-B', { id: 'user-b', email: 'b@x.com' });
  accounts.set('a@x.com', 'senha-correta');
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => server.close() };
}
