import fs from 'node:fs';
const rd = (f) => fs.readFileSync(f, 'utf8');
const strip = (s) => s.replace(/^import .*$/gm, '').replace(/^export (const|function|async function|class) /gm, '$1 ').replace(/^export \{[^}]*\};?$/gm, '');

let app = rd('public/app.js');
app = app.replace(/location\.hash = lastHash;/, 'loc._h = lastHash;')
  .replace(/location\.hash/g, 'loc.hash')
  .replace("window.addEventListener('hashchange', navigate);\n  navigate();", "document.addEventListener('click', (e) => { const a = e.target.closest('a[href^=\"#/\"]'); if (a) { e.preventDefault(); loc.hash = a.getAttribute('href'); } });\n  navigate();")
  // imprimir não funciona dentro do artefato
  .replace(/,\n[^\n]*'Imprimir'\)\]\),/, ']),');
if (/Imprimir/.test(app) || /exportUrl/.test(app) || /href: api\./.test(app)) throw new Error('patch falhou');

const recorder = rd('public/recorder.js').replace(/export function recordingSupport\(\) \{[\s\S]*?\n\}\n/, `export function recordingSupport() {
  return { ok: false, reason: 'A gravação pelo microfone não está disponível nesta versão de demonstração hospedada.' };
}
`);
const css = rd('public/styles.css');
const logo = 'data:image/svg+xml;base64,' + Buffer.from(rd('public/logo.svg')).toString('base64');
const js = [strip(rd('server/schema.js')), strip(rd('server/ai/demo.js')), strip(rd('server/markdown.js')), strip(rd('demo-web/mock-api.js')),
  strip(rd('public/util.js')), strip(rd('public/auth.js')), strip(recorder), strip(app).replace(/^const main = /m, 'const loc = { _h: "#/", get hash() { return this._h; }, set hash(v) { this._h = v; navigate(); } };\nconst main = ')].join('\n');

const html = `<title>Confere</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css.replace(/\n:root \{/, '\n:root {')}
html, body { background: var(--bg); }
body { color: var(--text); padding-block: 0; padding-left: max(0px, env(safe-area-inset-left, 0px)); padding-right: max(0px, env(safe-area-inset-right, 0px)); }
main { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.topbar { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
</style>
<a class="skip" href="#main">Ir para o conteúdo</a>
<header class="topbar"><a href="#/" class="brand"><img src="${logo}" alt="">Confere</a><span id="mode-badge" class="badge" hidden></span><nav id="account" class="account"></nav></header>
<main id="main" tabindex="-1"></main>
<div id="live" class="sr-only" aria-live="polite"></div>
<dialog id="confirm" aria-labelledby="confirm-title"><form method="dialog"><h2 id="confirm-title"></h2><p id="confirm-text"></p>
<div class="row end"><button value="cancel" class="btn">Cancelar</button><button value="ok" class="btn danger" id="confirm-ok">Confirmar</button></div></form></dialog>
<script>
${js}
</script>`;
fs.writeFileSync(process.argv[2], html);
console.log('ok', html.length);
