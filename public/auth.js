// Sessão do usuário (modo serviço). O navegador só fala com /api/auth/*; as chaves do Supabase ficam no servidor.
const KEY = 'confere_session';
let mem = null;
let refreshing = null;

function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { mem = null; }
  return mem;
}
function save(s) {
  mem = s;
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* sem armazenamento: vale só nesta aba */ }
}

async function post(path, body) {
  let res;
  try { res = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('Não foi possível conectar ao servidor.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível concluir. Tente de novo.');
  return data;
}

export const auth = {
  enabled: false,
  session: () => load(),
  async login(email, password) { const s = await post('login', { email, password }); save(s); return s; },
  async signup(email, password) { const d = await post('signup', { email, password }); if (d.access_token) save(d); return d; },
  recover: (email) => post('recover', { email }),
  logout() { save(null); },
  /** Token válido (renova se faltar menos de 1 min). null = precisa entrar de novo. */
  async token() {
    const s = load();
    if (!s) return null;
    if (s.expires_at * 1000 - Date.now() > 60000) return s.access_token;
    refreshing ??= post('refresh', { refresh_token: s.refresh_token })
      .then((n) => { save(n); return n.access_token; })
      .catch(() => { save(null); return null; })
      .finally(() => { refreshing = null; });
    return refreshing;
  },
};
