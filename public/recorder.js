// Lógica de gravação no navegador, independente da interface.
// Estados: idle → recording ⇄ paused → stopped | error. Emite 'state' a cada mudança.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

export function recordingSupport() {
  if (!window.isSecureContext) return { ok: false, reason: 'A gravação exige HTTPS ou localhost.' };
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { ok: false, reason: 'Este navegador não oferece gravação de áudio.' };
  }
  return { ok: true };
}

export class MeetingRecorder extends EventTarget {
  state = 'idle';
  error = null;
  backgrounded = false;
  #chunks = []; #rec = null; #stream = null; #wake = null;
  #accum = 0; #since = 0; #onVis = null;

  get elapsedSec() {
    return this.#accum + (this.state === 'recording' ? (performance.now() - this.#since) / 1000 : 0);
  }

  #set(state, error = null) {
    this.state = state; this.error = error;
    this.dispatchEvent(new Event('state'));
  }

  async start() {
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // permissão só aqui
    } catch (e) {
      const msg = e.name === 'NotAllowedError' ? 'Permissão do microfone negada. Libere o acesso nas configurações do navegador ou envie um arquivo de áudio.'
        : e.name === 'NotFoundError' ? 'Nenhum microfone foi encontrado neste dispositivo.'
        : `Não foi possível acessar o microfone (${e.message}).`;
      return this.#set('error', msg);
    }
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    try {
      this.#rec = new MediaRecorder(this.#stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      this.#release();
      return this.#set('error', `Este navegador não conseguiu iniciar a gravação (${e.message}). Envie um arquivo de áudio.`);
    }
    this.#chunks = []; this.#accum = 0; this.backgrounded = false;
    this.#rec.ondataavailable = (e) => e.data.size && this.#chunks.push(e.data);
    this.#rec.onerror = (e) => this.#fail(`A gravação foi interrompida (${e.error?.message || 'erro desconhecido'}).`);
    this.#stream.getAudioTracks()[0].addEventListener('ended', () =>
      this.#fail('O microfone foi desconectado ou o sistema encerrou a captura.'));
    this.#onVis = () => { if (document.hidden && this.state === 'recording') this.backgrounded = true; this.dispatchEvent(new Event('state')); };
    document.addEventListener('visibilitychange', this.#onVis);
    this.#rec.start(1000); // blocos de 1 s: o que já foi capturado sobrevive a falhas
    this.#since = performance.now();
    this.#requestWakeLock();
    this.#set('recording');
  }

  pause() {
    if (this.state !== 'recording') return;
    this.#rec.pause(); this.#accum += (performance.now() - this.#since) / 1000;
    this.#set('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.#rec.resume(); this.#since = performance.now();
    this.#set('recording');
  }

  /** Encerra e devolve o áudio capturado (ou null se nada foi capturado). */
  stop() {
    return new Promise((resolve) => {
      if (!this.#rec || this.#rec.state === 'inactive') return resolve(this.#collect());
      if (this.state === 'recording') this.#accum += (performance.now() - this.#since) / 1000;
      this.#rec.onstop = () => { this.#release(); this.#set('stopped'); resolve(this.#collect()); };
      this.#rec.stop();
    });
  }

  discard() { this.#chunks = []; try { this.#rec?.state !== 'inactive' && this.#rec?.stop(); } catch { /* já parado */ } this.#release(); this.#set('idle'); }

  #collect() {
    if (!this.#chunks.length) return null;
    return new Blob(this.#chunks, { type: this.#rec?.mimeType || this.#chunks[0].type || 'audio/webm' });
  }

  #fail(message) {
    if (this.state === 'error' || this.state === 'stopped') return;
    if (this.state === 'recording') this.#accum += (performance.now() - this.#since) / 1000;
    this.#release();
    this.#set('error', message); // blocos já capturados continuam disponíveis via salvage()
  }

  /** Áudio parcial capturado antes de uma falha. */
  salvage() { return this.#collect(); }

  async #requestWakeLock() {
    try { this.#wake = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
  }

  #release() {
    this.#stream?.getTracks().forEach((t) => t.stop()); this.#stream = null;
    this.#wake?.release?.().catch(() => {}); this.#wake = null;
    if (this.#onVis) document.removeEventListener('visibilitychange', this.#onVis);
  }
}
