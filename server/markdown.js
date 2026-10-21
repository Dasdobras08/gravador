// Exportação em Markdown. Marca claramente o que é sugestão da IA, editado ou sem trecho verificado.
const ts = (s) => {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
};

export function toMarkdown(m) {
  const segs = m.transcript?.segments ?? [];
  const r = m.result;
  const refs = (item) => {
    if (!item.evidence?.length) return '';
    return ' — trechos: ' + item.evidence.map((i) => `[${ts(segs[i]?.start ?? 0)}]`).join(' ');
  };
  const tag = (item) => {
    const t = [];
    if (item.origin === 'sugestao_ia') t.push('_sugestão da IA, não foi dito na reunião_');
    if (item.origin === 'manual') t.push('_adicionado manualmente_');
    if (item.unverified) t.push('_sem trecho de apoio verificado_');
    if (item.edited) t.push('_editado_');
    return t.length ? ` (${t.join('; ')})` : '';
  };

  const out = [`# ${m.title}`, '', `Gravada em ${new Date(m.createdAt).toLocaleString('pt-BR')}`, ''];
  if (m.demo) out.push('> **DEMONSTRAÇÃO:** conteúdo de exemplo, não gerado a partir do áudio.', '');
  if (!r) {
    out.push('_Resumo ainda não disponível._');
    return out.join('\n');
  }
  out.push('> Resumo gerado por IA. Confira os trechos indicados antes de confiar em qualquer ponto.', '');
  if (r.warnings.length) out.push('## Avisos', ...r.warnings.map((w) => `- ⚠️ ${w}`), '');
  if (r.overview) out.push('## Visão geral', r.overview, '');
  out.push('## Tópicos');
  if (!r.topics.length) out.push('_Nenhum tópico._');
  for (const t of r.topics) {
    out.push('', `### ${t.title || 'Sem título'}`);
    for (const p of t.points) out.push(`- ${p.text}${refs(p)}${tag(p)}`);
  }
  out.push('', '## Decisões');
  if (!r.decisions.length) out.push('_Nenhuma decisão identificada._');
  for (const d of r.decisions) out.push(`- ${d.text}${refs(d)}${tag(d)}`);
  out.push('', '## Tarefas e próximos passos');
  if (!r.tasks.length) out.push('_Nenhuma tarefa identificada._');
  for (const t of r.tasks) {
    out.push(`- [${t.done ? 'x' : ' '}] ${t.text} — responsável: ${t.owner || 'não especificado'}; prazo: ${t.deadline || 'não especificado'}${refs(t)}${tag(t)}`);
  }
  if (segs.length) {
    out.push('', '## Transcrição');
    for (const s of segs) out.push(`- **[${ts(s.start)}]** ${s.text}`);
  }
  return out.join('\n') + '\n';
}
