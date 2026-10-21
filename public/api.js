async function request(path, opts = {}) {
  let res;
  try { res = await fetch(path, opts); } catch { throw new Error('Não foi possível conectar ao servidor. Ele está em execução?'); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

export const api = {
  config: () => request('/api/config'),
  list: () => request('/api/meetings'),
  get: (id) => request(`/api/meetings/${id}`),
  remove: (id) => request(`/api/meetings/${id}`, { method: 'DELETE' }),
  retry: (id) => request(`/api/meetings/${id}/retry`, { method: 'POST' }),
  patch: (id, body) => request(`/api/meetings/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  audioUrl: (id) => `/api/meetings/${id}/audio`,
  exportUrl: (id) => `/api/meetings/${id}/export.md`,

  /** Envia o áudio com progresso (fetch ainda não expõe progresso de upload). */
  upload(blob, { title, filename, source, duration, marks }, onProgress) {
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams({ title, filename, source });
      if (duration) q.set('duration', String(Math.round(duration)));
      if (marks?.length) q.set('marks', marks.join(','));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/meetings?${q}`);
      xhr.setRequestHeader('Content-Type', (blob.type || 'application/octet-stream').split(';')[0]);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () => reject(new Error('Falha de rede durante o envio. O áudio continua no seu navegador; tente novamente.'));
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignora */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `O servidor recusou o envio (${xhr.status}).`));
      };
      xhr.send(blob);
    });
  },
};
