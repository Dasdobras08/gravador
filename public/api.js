import { auth } from './auth.js';

/** Sessão inválida: limpa e avisa a interface para voltar ao login. */
function expired() {
  auth.logout();
  window.dispatchEvent(new Event('confere:logout'));
  return new Error('Sua sessão expirou. Entre novamente.');
}

async function authHeaders() {
  if (!auth.enabled) return {};
  const t = await auth.token();
  if (!t) throw expired();
  return { Authorization: `Bearer ${t}` };
}

async function raw(path, opts = {}) {
  const headers = { ...(await authHeaders()), ...(opts.headers || {}) };
  let res;
  try { res = await fetch(path, { ...opts, headers }); } catch { throw new Error('Não foi possível conectar ao servidor. Ele está em execução?'); }
  if (res.status === 401 && auth.enabled) throw expired();
  return res;
}

async function request(path, opts = {}) {
  const res = await raw(path, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erro ${res.status}`), { status: res.status });
  return data;
}

export const api = {
  config: () => fetch('/api/config').then((r) => r.json()),
  me: () => request('/api/me'),
  list: () => request('/api/meetings'),
  get: (id) => request(`/api/meetings/${id}`),
  remove: (id) => request(`/api/meetings/${id}`, { method: 'DELETE' }),
  retry: (id) => request(`/api/meetings/${id}/retry`, { method: 'POST' }),
  patch: (id, body) => request(`/api/meetings/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),

  /** URL tocável do áudio. Com login o <audio> não envia cabeçalhos, então baixamos como blob. */
  async audioUrl(id) {
    if (!auth.enabled) return `/api/meetings/${id}/audio`;
    const res = await raw(`/api/meetings/${id}/audio`);
    if (!res.ok) throw new Error('Não foi possível carregar o áudio.');
    return URL.createObjectURL(await res.blob());
  },

  /** Baixa o Markdown (com login, via fetch + blob). */
  async downloadExport(id) {
    const res = await raw(`/api/meetings/${id}/export.md`);
    if (!res.ok) throw new Error('Não foi possível exportar.');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: `reuniao-${id.slice(0, 8)}.md` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  },

  /** Envia o áudio com progresso (fetch ainda não expõe progresso de upload). */
  async upload(blob, { title, filename, source, duration, marks }, onProgress) {
    const headers = await authHeaders();
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams({ title, filename, source });
      if (duration) q.set('duration', String(Math.round(duration)));
      if (marks?.length) q.set('marks', marks.join(','));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/meetings?${q}`);
      xhr.setRequestHeader('Content-Type', (blob.type || 'application/octet-stream').split(';')[0]);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () => reject(new Error('Falha de rede durante o envio. O áudio continua no seu navegador; tente novamente.'));
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignora */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else if (xhr.status === 401 && auth.enabled) reject(expired());
        else reject(Object.assign(new Error(data.error || `O servidor recusou o envio (${xhr.status}).`), { status: xhr.status }));
      };
      xhr.send(blob);
    });
  },
};
