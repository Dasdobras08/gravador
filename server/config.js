import fs from 'node:fs';
import path from 'node:path';

// Carrega .env simples (sem dependências). Variáveis já definidas no ambiente têm prioridade.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function loadConfig(env = process.env) {
  const key = env.OPENAI_API_KEY || '';
  const requested = (env.AI_PROVIDER || '').toLowerCase();
  const provider = requested || (key ? 'openai' : 'demo');
  return {
    port: Number(env.PORT || 3000),
    appPassword: env.APP_PASSWORD || '', // se definida, o app exige senha (HTTP Basic; usuário livre)
    host: env.HOST || '127.0.0.1',
    dataDir: path.resolve(env.DATA_DIR || './data'),
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
    provider,
    // Se SUPABASE_URL estiver definida, o app exige login e guarda tudo no Supabase (modo serviço).
    supabase: {
      url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
      anonKey: env.SUPABASE_ANON_KEY || '',
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
      bucket: env.SUPABASE_AUDIO_BUCKET || 'audio',
    },
    openai: {
      apiKey: key,
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      transcriptionModel: env.TRANSCRIPTION_MODEL || 'whisper-1',
      summaryModel: env.SUMMARY_MODEL || 'gpt-4o-mini',
      language: env.TRANSCRIPTION_LANGUAGE || 'pt',
    },
  };
}

export { loadDotEnv };
