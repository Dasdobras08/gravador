// Cliente mínimo do Supabase (Auth, PostgREST e Storage) por HTTP, sem dependências.
// `auth` é { token } para agir como o usuário (RLS vale) ou 'service' para a chave de serviço.

export class UpstreamError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

export function createSupabase({ url, anonKey, serviceKey, bucket = 'audio' }) {
  const bearer = (auth) => (auth === 'service' ? serviceKey : auth.token);
  const apikey = (auth) => (auth === 'service' ? serviceKey : anonKey);
  const headers = (auth, extra = {}) => ({ apikey: apikey(auth), Authorization: `Bearer ${bearer(auth)}`, ...extra });

  async function call(what, input, init) {
    let res;
    try { res = await fetch(input, { ...init, signal: AbortSignal.timeout(120000) }); }
    catch (e) { throw new UpstreamError(`Não foi possível contatar o Supabase (${what}).`, 502, e.message); }
    return res;
  }
  async function jsonOrThrow(what, res) {
    if (res.ok) return res.status === 204 ? null : res.json().catch(() => null);
    const detail = await res.text().catch(() => '');
    const status = res.status === 401 || res.status === 403 ? 403 : res.status === 404 ? 404 : 502;
    throw new UpstreamError(`Falha ao acessar os dados (${what}).`, status, `${res.status} ${detail.slice(0, 300)}`);
  }

  const sb = {
    url,
    /** Valida o token no Supabase e devolve { id, email } (cache curto). */
    async getUser(token) {
      if (!token) return null;
      const hit = sb._cache.get(token);
      if (hit && hit.until > Date.now()) return hit.user;
      const res = await call('auth', `${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const u = await res.json().catch(() => null);
      if (!u?.id) return null;
      const user = { id: u.id, email: u.email };
      sb._cache.set(token, { user, until: Date.now() + 60000 });
      if (sb._cache.size > 500) sb._cache.delete(sb._cache.keys().next().value);
      return user;
    },
    _cache: new Map(),

    /** Chamadas ao GoTrue com a chave pública (usadas pelo proxy /api/auth/*). */
    async authCall(path, body) {
      const res = await call('auth', `${url}/auth/v1${path}`, {
        method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    },

    async rest(auth, method, path, { body, prefer } = {}) {
      const res = await call('dados', `${url}/rest/v1/${path}`, {
        method,
        headers: headers(auth, { 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return jsonOrThrow(`${method} ${path.split('?')[0]}`, res);
    },
    rpc: (auth, fn, args = {}) => sb.rest(auth, 'POST', `rpc/${fn}`, { body: args }),

    storage: {
      async put(auth, path, buffer, mime) {
        const res = await call('áudio', `${url}/storage/v1/object/${bucket}/${path}`, {
          method: 'POST', headers: headers(auth, { 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' }), body: buffer,
        });
        return jsonOrThrow('upload de áudio', res);
      },
      async get(auth, path, range) {
        return call('áudio', `${url}/storage/v1/object/authenticated/${bucket}/${path}`, {
          headers: headers(auth, range ? { Range: range } : {}),
        });
      },
      async remove(auth, path) {
        const res = await call('áudio', `${url}/storage/v1/object/${bucket}/${path}`, { method: 'DELETE', headers: headers(auth) });
        return jsonOrThrow('remoção de áudio', res);
      },
    },
  };
  return sb;
}
