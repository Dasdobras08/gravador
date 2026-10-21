import { demoProvider } from './demo.js';
import { createOpenAIProvider } from './openai.js';

export function createProvider(config) {
  if (config.provider === 'demo') return demoProvider;
  if (config.provider === 'openai') {
    if (!config.openai.apiKey) {
      throw new Error('AI_PROVIDER=openai exige OPENAI_API_KEY. Defina a chave ou use AI_PROVIDER=demo.');
    }
    return createOpenAIProvider(config.openai);
  }
  throw new Error(`AI_PROVIDER desconhecido: "${config.provider}". Use "openai" ou "demo".`);
}
