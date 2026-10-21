import { h, fmtTime, fmtDate, announce, confirmDialog } from './util.js';
import { api } from './api.js';
import { MeetingRecorder, recordingSupport } from './recorder.js';

const main = document.getElementById('main');
let config = { demo: false, maxUploadMb: 25 };
let timer = null; // polling / cronômetro da view atual
let cleanup = () => {};
let guard = () => false; // true enquanto há gravação em andamento
let lastHash = location.hash || '#/';

const STATUS = {
  transcribing: ['Transcrevendo', 'proc'], summarizing: ['Gerando resumo', 'proc'],
  ready: ['Pronta', 'ready'], error: ['Com erro', 'error'],
};
const statusBadge = (m) => h('span', { class: `badge ${STATUS[m.status][1]}` }, STATUS[m.status][0]);

function navigate() {
  if (guard() && location.hash !== lastHash) {
    location.hash = lastHash; // não abandona uma gravação ativa sem querer
    announce('Encerre ou descarte a gravação antes de sair desta página.');
    return;
  }
  lastHash = location.hash || '#/';
  guard = () => false;
  clearInterval(timer); cleanup(); cleanup = () => {};
  main.classList.remove('wide');
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/m\/([\w-]+)$/);
  (m ? meetingView(m[1]) : homeView()).catch((e) => {
    main.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, e.message), h('a', { href: '#/' }, '← Voltar à lista'));
  });
  main.focus();
}

/* ---------------------------------------------------------------- Início */

async function homeView() {
  const consent = h('input', { type: 'checkbox', id: 'consent' });
  const title = h('input', { type: 'text', id: 'title', placeholder: 'Ex.: Planejamento do trimestre', maxLength: 200 });
  const recBox = h('div', { class: 'card primary' });
  const upBox = h('div', { class: 'card' });
  const listBox = h('div', { class: 'card' });
  const support = recordingSupport();

  /* --- gravação --- */
  const rec = new MeetingRecorder();
  const status = h('div', { role: 'status' });
  const startBtn = h('button', { class: 'btn primary big', type: 'button' }, 'Iniciar gravação');
  const pauseBtn = h('button', { class: 'btn', type: 'button' }, 'Pausar');
  const stopBtn = h('button', { class: 'btn primary', type: 'button' }, 'Encerrar e processar');
  const discardBtn = h('button', { class: 'btn danger', type: 'button' }, 'Descartar');
  const controls = h('div', { class: 'row' });
  const pending = { blob: null, duration: 0 }; // áudio capturado que ainda não foi enviado

  const needConsent = () => {
    if (consent.checked) return true;
    announce('Confirme a autorização antes de continuar.');
    consent.focus();
    return false;
  };

  async function send(blob, meta, source) {
    const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Progresso do envio' });
    const label = h('p', { role: 'status' }, 'Enviando…');
    status.replaceChildren(label, bar);
    try {
      const m = await api.upload(blob, { ...meta, source }, (p) => { bar.value = p; label.textContent = `Enviando… ${Math.round(p * 100)}%`; });
      pending.blob = null;
      location.hash = `#/m/${m.id}`;
    } catch (e) {
      const retry = h('button', { class: 'btn primary', type: 'button', onclick: () => send(blob, meta, source) }, 'Tentar enviar novamente');
      const save = h('a', { class: 'btn', download: `reuniao-${Date.now()}.${(blob.type.split('/')[1] || 'webm').split(';')[0]}`, href: URL.createObjectURL(blob) }, 'Salvar áudio no dispositivo');
      status.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, `Erro no envio: ${e.message}`), h('div', { class: 'row' }, retry, save));
    }
  }

  function renderRec() {
    const s = rec.state;
    controls.replaceChildren();
    if (s === 'recording' || s === 'paused') {
      const clock = h('span', { 'aria-hidden': 'true' }, fmtTime(rec.elapsedSec));
      status.replaceChildren(
        h('div', { class: `rec-indicator ${s === 'paused' ? 'paused' : ''}` }, h('span', { class: 'dot' }),
          s === 'paused' ? 'Gravação PAUSADA' : 'GRAVANDO', clock),
        rec.backgrounded ? h('div', { class: 'notice' }, 'A aba ficou em segundo plano. Alguns navegadores e celulares suspendem a captura nessa situação; confira se o tempo continua avançando e escute o áudio depois.') : null,
        h('p', { class: 'muted' }, 'Mantenha esta aba aberta e o dispositivo ativo durante a reunião.'),
      );
      pauseBtn.textContent = s === 'paused' ? 'Retomar' : 'Pausar';
      controls.append(pauseBtn, stopBtn, discardBtn);
      announce(s === 'paused' ? 'Gravação pausada' : 'Gravando');
    } else if (s === 'error') {
      const partial = rec.salvage();
      status.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, rec.error));
      if (partial) {
        const blob = partial;
        controls.append(h('button', { class: 'btn primary', type: 'button', onclick: () => send(blob, { title: title.value.trim(), filename: 'gravacao-parcial', duration: rec.elapsedSec }, 'gravacao') }, 'Enviar o trecho já capturado'));
      }
      controls.append(h('button', { class: 'btn', type: 'button', onclick: () => rec.discard() }, 'Fechar'));
    } else {
      if (!pending.blob) status.replaceChildren();
      controls.append(startBtn);
    }
    startBtn.disabled = !support.ok;
  }

  startBtn.onclick = async () => {
    if (!needConsent()) return;
    await rec.start();
  };
  pauseBtn.onclick = () => (rec.state === 'paused' ? rec.resume() : rec.pause());
  stopBtn.onclick = async () => {
    const duration = rec.elapsedSec;
    const blob = await rec.stop();
    if (!blob) return status.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, 'Nenhum áudio foi capturado.'));
    pending.blob = blob;
    await send(blob, { title: title.value.trim(), filename: 'gravacao', duration }, 'gravacao');
    rec.state = 'idle'; renderRec();
  };
  discardBtn.onclick = async () => {
    if (await confirmDialog('Descartar gravação?', 'O áudio capturado até agora será perdido e não poderá ser recuperado.', 'Descartar')) rec.discard();
  };
  rec.addEventListener('state', renderRec);
  const tick = setInterval(() => { if (rec.state === 'recording') { const c = status.querySelector('.rec-indicator span[aria-hidden]'); if (c) c.textContent = fmtTime(rec.elapsedSec); } }, 500);
  const warnUnload = (e) => { if (rec.state === 'recording' || rec.state === 'paused') { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warnUnload);
  guard = () => rec.state === 'recording' || rec.state === 'paused';
  cleanup = () => { clearInterval(tick); window.removeEventListener('beforeunload', warnUnload); if (rec.state === 'recording' || rec.state === 'paused') rec.discard(); };

  recBox.append(
    h('h2', {}, 'Gravar agora'),
    support.ok ? null : h('div', { class: 'notice' }, `${support.reason} Use o envio de arquivo ao lado.`),
    controls, status,
  );

  /* --- upload de arquivo --- */
  const file = h('input', { type: 'file', id: 'file', accept: 'audio/*,video/mp4,video/webm' });
  const upStatus = h('div', { role: 'status' });
  const upBtn = h('button', { class: 'btn primary', type: 'button' }, 'Enviar e processar');
  upBtn.onclick = async () => {
    if (!needConsent()) return;
    const f = file.files[0];
    if (!f) return upStatus.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, 'Escolha um arquivo de áudio primeiro.'));
    if (f.size > config.maxUploadMb * 1048576) return upStatus.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, `O arquivo tem ${(f.size / 1048576).toFixed(1)} MB e o limite é ${config.maxUploadMb} MB. Divida ou comprima o áudio.`));
    const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Progresso do envio' });
    upStatus.replaceChildren(h('p', {}, 'Enviando…'), bar);
    upBtn.disabled = true;
    try {
      const m = await api.upload(f, { title: title.value.trim() || f.name.replace(/\.[^.]+$/, ''), filename: f.name, source: 'arquivo' }, (p) => { bar.value = p; });
      location.hash = `#/m/${m.id}`;
    } catch (e) {
      upBtn.disabled = false;
      upStatus.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, e.message));
    }
  };
  upBox.append(h('h2', {}, 'Enviar arquivo de áudio'), h('label', { for: 'file' }, 'Arquivo (mp3, m4a, wav, webm, ogg…)'), file,
    h('p', { class: 'muted' }, `Tamanho máximo: ${config.maxUploadMb} MB.`), upBtn, upStatus);

  /* --- lista --- */
  async function refreshList() {
    const items = await api.list();
    const busy = items.some((m) => m.status === 'transcribing' || m.status === 'summarizing');
    listBox.replaceChildren(h('h2', {}, 'Suas reuniões'),
      items.length ? h('ul', { class: 'list' }, items.map((m) => h('li', {}, h('a', { class: 'item', href: `#/m/${m.id}` },
        h('span', {}, h('span', { class: 'title' }, m.title), h('br'),
          h('span', { class: 'meta' }, fmtDate(m.createdAt), m.durationSec ? ` · ${fmtTime(m.durationSec)}` : '', m.source === 'arquivo' ? ' · arquivo enviado' : ' · gravada no navegador')),
        h('span', {}, m.demo ? h('span', { class: 'badge demo' }, 'demonstração ') : null, statusBadge(m)))))) 
        : h('p', { class: 'muted' }, 'Nenhuma reunião por aqui ainda. Grave ou envie um áudio acima para começar.'));
    return busy;
  }
  await refreshList();
  timer = setInterval(() => refreshList().catch(() => {}), 3000);

  main.replaceChildren(
    h('div', { class: 'hero' }, h('h1', {}, 'Participe da reunião. ', h('span', { class: 'hl' }, 'Depois, confira.')), h('p', { class: 'lead' }, 'Grave ou envie o áudio e receba um resumo com decisões e tarefas ligadas aos trechos da conversa, para você conferir cada ponto.')),
    config.demo ? h('div', { class: 'notice' }, h('strong', {}, 'Modo demonstração. '), 'Nenhum serviço de IA está configurado: o áudio não será transcrito de verdade e o resultado será um exemplo fixo. Defina OPENAI_API_KEY no servidor para o processamento real.') : null,
    h('div', { class: 'card' },
      h('label', { for: 'title' }, 'Título da reunião (opcional)'), title,
      h('label', { class: 'check' }, consent, h('span', {}, 'Tenho autorização dos participantes (e/ou da minha organização) para gravar ou enviar esta reunião. O áudio é guardado apenas no servidor deste app e pode ser excluído a qualquer momento.'))),
    h('div', { class: 'grid' }, recBox, upBox),
    listBox);
  renderRec();
}

/* ------------------------------------------------------------- Resultado */

const STEPS = [['transcribing', 'Transcrevendo'], ['summarizing', 'Gerando resumo'], ['ready', 'Concluído']];

async function meetingView(id) {
  main.classList.add('wide');
  let m = await api.get(id);
  let editing = false;
  let draft = null;
  const root = h('div');
  const audio = h('audio', { controls: true, preload: 'metadata', src: api.audioUrl(id), 'aria-label': 'Áudio da reunião' });
  main.replaceChildren(root);

  const seek = (sec, segIndex) => {
    audio.currentTime = sec; audio.play().catch(() => {});
    document.querySelectorAll('.seg.hl').forEach((e) => e.classList.remove('hl'));
    const el = document.getElementById(`seg-${segIndex}`);
    el?.classList.add('hl');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const segs = () => m.transcript?.segments ?? [];

  const evidenceView = (item) => {
    if (!item.evidence?.length) return null;
    return h('div', {},
      item.evidence.map((i) => h('button', { class: 'chip', type: 'button', title: 'Ouvir este trecho', onclick: () => seek(segs()[i].start, i) }, `▶ ${fmtTime(segs()[i].start)}`)),
      h('details', { class: 'quotes' }, h('summary', {}, 'Ver trecho da conversa'),
        item.evidence.map((i) => h('blockquote', {}, h('span', { class: 'meta' }, `[${fmtTime(segs()[i].start)}] `), segs()[i].text))));
  };
  const tags = (item) => h('span', { class: 'tags' },
    item.origin === 'sugestao_ia' ? h('span', { class: 'tag ai' }, 'Sugestão da IA — não foi dito') : null,
    item.origin === 'manual' ? h('span', { class: 'tag' }, 'Adicionado por você') : null,
    item.unverified ? h('span', { class: 'tag unv' }, 'Sem trecho de apoio verificado') : null,
    item.edited ? h('span', { class: 'tag' }, 'Editado') : null);

  /* --- edição --- */
  const startEdit = () => { draft = structuredClone(m.result); editing = true; render(); };
  const input = (obj, key, label, multiline = true) => {
    const el = h(multiline ? 'textarea' : 'input', { 'aria-label': label, value: obj[key] ?? '', ...(multiline ? {} : { type: 'text', placeholder: 'não especificado' }) });
    el.addEventListener('input', () => { obj[key] = el.value; });
    return el;
  };
  const removeBtn = (arr, i, what) => h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remover ${what}`, onclick: () => { arr.splice(i, 1); render(); } }, 'Remover');
  const addBtn = (label, fn) => h('button', { class: 'btn small', type: 'button', onclick: () => { fn(); render(); } }, label);

  async function saveEdit() {
    try { m = await api.patch(id, { result: draft }); editing = false; announce('Alterações salvas.'); render(); }
    catch (e) { root.querySelector('#save-err').replaceChildren(h('div', { class: 'notice error', role: 'alert' }, e.message)); }
  }

  /* --- seções --- */
  function summarySection() {
    const r = editing ? draft : m.result;
    const sec = h('section', { class: 'card' }, h('h2', {}, 'Resumo por tópicos'));
    if (editing) {
      sec.append(h('label', {}, 'Visão geral'), input(r, 'overview', 'Visão geral'));
      r.topics.forEach((t, ti) => sec.append(h('div', { class: 'item' },
        h('label', {}, 'Título do tópico'), input(t, 'title', 'Título do tópico', false),
        t.points.map((p, pi) => h('div', { class: 'row' }, h('div', { class: 'grow' }, input(p, 'text', 'Ponto do tópico')), removeBtn(t.points, pi, 'ponto'))),
        h('div', { class: 'row' }, addBtn('Adicionar ponto', () => t.points.push({ id: '', text: '' })), removeBtn(r.topics, ti, 'tópico')))));
      sec.append(addBtn('Adicionar tópico', () => r.topics.push({ id: '', title: '', points: [{ id: '', text: '' }] })));
      return sec;
    }
    if (r.overview) sec.append(h('p', {}, r.overview));
    if (!r.topics.length) sec.append(h('p', { class: 'muted' }, 'Nenhum tópico identificado.'));
    r.topics.forEach((t) => sec.append(h('div', {}, h('h3', {}, t.title || 'Sem título'),
      t.points.map((p) => h('div', { class: 'item' }, h('span', {}, p.text), tags(p), evidenceView(p))))));
    return sec;
  }

  function decisionsSection() {
    const r = editing ? draft : m.result;
    const sec = h('section', { class: 'card' }, h('h2', {}, 'Decisões'));
    if (!r.decisions.length && !editing) sec.append(h('p', { class: 'muted' }, 'Nenhuma decisão foi identificada na conversa.'));
    r.decisions.forEach((d, i) => sec.append(editing
      ? h('div', { class: 'item row' }, h('div', { class: 'grow' }, input(d, 'text', 'Decisão')), removeBtn(r.decisions, i, 'decisão'))
      : h('div', { class: 'item' }, h('span', {}, d.text), tags(d), evidenceView(d))));
    if (editing) sec.append(addBtn('Adicionar decisão', () => r.decisions.push({ id: '', text: '' })));
    return sec;
  }

  function tasksSection() {
    const r = editing ? draft : m.result;
    const sec = h('section', { class: 'card tasks-card' }, h('h2', {}, 'Tarefas e próximos passos'));
    if (!r.tasks.length && !editing) sec.append(h('p', { class: 'muted' }, 'Nenhuma tarefa foi identificada na conversa.'));
    r.tasks.forEach((t, i) => {
      if (editing) {
        sec.append(h('div', { class: 'item' }, input(t, 'text', 'Tarefa'),
          h('div', { class: 'grid' }, h('div', {}, h('label', {}, 'Responsável'), input(t, 'owner', 'Responsável', false)), h('div', {}, h('label', {}, 'Prazo'), input(t, 'deadline', 'Prazo', false))),
          removeBtn(r.tasks, i, 'tarefa')));
        return;
      }
      const box = h('input', { type: 'checkbox', checked: t.done, 'aria-label': `Concluída: ${t.text}` });
      box.onchange = async () => {
        try { m = await api.patch(id, { result: { ...m.result, tasks: m.result.tasks.map((x) => x.id === t.id ? { ...x, done: box.checked } : x) } }); render(); }
        catch (e) { box.checked = !box.checked; announce(e.message); }
      };
      sec.append(h('div', { class: 'item' }, h('label', { class: 'check' }, box, h('span', {}, t.text)), tags(t),
        h('div', { class: 'meta' }, `Responsável: ${t.owner || 'não especificado'} · Prazo: ${t.deadline || 'não especificado'}`), evidenceView(t)));
    });
    if (editing) sec.append(addBtn('Adicionar tarefa', () => r.tasks.push({ id: '', text: '', owner: '', deadline: '', done: false })));
    return sec;
  }

  function transcriptSection() {
    return h('section', { class: 'card' }, h('h2', {}, 'Transcrição'),
      m.demo ? h('div', { class: 'notice' }, 'Texto de exemplo (demonstração). Não é a transcrição do seu áudio.') : null,
      segs().map((s) => h('div', { class: 'seg', id: `seg-${s.i}` }, h('button', { class: 'chip', type: 'button', onclick: () => seek(s.start, s.i) }, `▶ ${fmtTime(s.start)}`), h('span', {}, s.text))));
  }

  /* --- processamento / erro --- */
  function progressSection() {
    const idx = STEPS.findIndex(([k]) => k === m.status);
    const failIdx = m.status === 'error' ? STEPS.findIndex(([k]) => k === m.failedStage) : -1;
    return h('section', { class: 'card', 'aria-live': 'polite' },
      h('h2', {}, m.status === 'error' ? 'O processamento falhou' : 'Processando a reunião'),
      h('ol', { class: 'steps' }, h('li', { class: 'done' }, '✓ Enviado'),
        STEPS.map(([k, label], i) => h('li', { class: failIdx === i ? 'fail' : (m.status !== 'error' && i < idx) || (m.status === 'error' && i < failIdx) ? 'done' : i === idx ? 'now' : '' }, label))),
      m.status === 'error'
        ? h('div', {}, h('div', { class: 'notice error', role: 'alert' }, m.error), h('p', { class: 'muted' }, 'O áudio continua guardado. Você pode tentar de novo ou excluir a reunião.'),
          h('button', { class: 'btn primary', type: 'button', onclick: async () => { await api.retry(id); m = await api.get(id); render(); poll(); } }, 'Tentar novamente'))
        : h('p', { class: 'muted' }, 'Você pode sair desta página; o processamento continua no servidor. Arquivos longos levam mais tempo.'));
  }

  function render() {
    const titleInput = h('input', { type: 'text', value: m.title, 'aria-label': 'Título da reunião', id: 'meeting-title', maxLength: 200 });
    titleInput.onchange = async () => { try { m = await api.patch(id, { title: titleInput.value }); announce('Título salvo.'); } catch (e) { announce(e.message); } };
    const del = h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (await confirmDialog('Excluir esta reunião?', 'O áudio, a transcrição, o resumo e todos os dados derivados serão apagados permanentemente. Esta ação não pode ser desfeita.', 'Excluir definitivamente')) {
        await api.remove(id); location.hash = '#/';
      } } }, 'Excluir reunião');

    const ready = m.status === 'ready';
    root.replaceChildren(
      h('p', { class: 'no-print' }, h('a', { href: '#/' }, '← Todas as reuniões')),
      h('div', { class: 'row between' }, h('h1', {}, m.title), statusBadge(m)),
      h('p', { class: 'meta' }, `${fmtDate(m.createdAt)}${m.durationSec ? ` · ${fmtTime(m.durationSec)}` : ''}`),
      m.demo ? h('div', { class: 'notice' }, h('strong', {}, 'DEMONSTRAÇÃO: '), 'o conteúdo abaixo é um exemplo fixo e não foi gerado a partir do seu áudio.') : null,
      h('div', { class: 'no-print' }, h('label', { for: 'meeting-title' }, 'Título'), titleInput, ready ? null : h('div', { class: 'card' }, audio)),
      ready ? h('div', {}, m.result.warnings.map((w) => h('div', { class: 'notice' }, '⚠️ ', w)),
        h('div', { class: 'notice' }, 'Resumo gerado por IA. Itens com ▶ levam ao trecho da gravação: confira antes de confiar. Itens marcados como sugestão não foram ditos na reunião.'),
        h('div', { class: 'row no-print' },
          editing ? [h('button', { class: 'btn primary', type: 'button', onclick: saveEdit }, 'Salvar alterações'), h('button', { class: 'btn', type: 'button', onclick: () => { editing = false; render(); } }, 'Cancelar')]
            : [h('button', { class: 'btn', type: 'button', onclick: startEdit }, 'Editar resumo e tarefas'),
              h('a', { class: 'btn', href: api.exportUrl(id), download: '' }, 'Exportar Markdown'),
              h('button', { class: 'btn', type: 'button', onclick: () => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); window.print(); } }, 'Imprimir')]),
        h('div', { id: 'save-err' }),
          h('div', { class: 'result-layout' }, h('div', { class: 'main-col' }, tasksSection(), decisionsSection(), summarySection()),
            h('aside', { class: 'side-col', 'aria-label': 'Áudio e transcrição' }, h('div', { class: 'card no-print' }, audio), transcriptSection())))
        : progressSection(),
      h('div', { class: 'no-print' }, del));
  }

  function poll() {
    clearInterval(timer);
    if (m.status !== 'transcribing' && m.status !== 'summarizing') return;
    timer = setInterval(async () => {
      try {
        const next = await api.get(id);
        if (next.status !== m.status) { m = next; render(); announce(`Status: ${STATUS[m.status][0]}`); }
        if (m.status === 'ready' || m.status === 'error') clearInterval(timer);
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 2000);
  }

  render();
  poll();
}

/* ------------------------------------------------------------------ Início */

(async () => {
  try {
    config = await api.config();
    const badge = document.getElementById('mode-badge');
    badge.hidden = false;
    badge.textContent = config.demo ? 'Modo demonstração' : `IA: ${config.provider}`;
    if (config.demo) badge.classList.add('demo');
  } catch { /* a view mostrará o erro de conexão */ }
  window.addEventListener('hashchange', navigate);
  navigate();
})();
