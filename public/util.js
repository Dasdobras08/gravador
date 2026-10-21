/** Cria elementos sem innerHTML (todo texto entra via textContent → sem XSS). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtTime(sec) {
  const t = Math.max(0, Math.floor(sec || 0));
  const p = (n) => String(n).padStart(2, '0');
  const hh = Math.floor(t / 3600);
  return hh ? `${hh}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}` : `${p(Math.floor(t / 60))}:${p(t % 60)}`;
}

export const fmtDate = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function announce(msg) {
  const live = document.getElementById('live');
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 50);
}

export function confirmDialog(title, text, okLabel) {
  const dlg = document.getElementById('confirm');
  dlg.querySelector('#confirm-title').textContent = title;
  dlg.querySelector('#confirm-text').textContent = text;
  dlg.querySelector('#confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal();
  });
}
