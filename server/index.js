import path from 'node:path';
import { loadConfig, loadDotEnv } from './config.js';
import { createProvider } from './ai/index.js';
import { createApp } from './app.js';

loadDotEnv(path.resolve('.env'));
const config = loadConfig();
const provider = createProvider(config);
const { server, pipeline } = await createApp({ config, provider });

await pipeline.recover();
server.listen(config.port, config.host, () => {
  console.log(`Gravador em http://${config.host}:${config.port}`);
  console.log(provider.demo
    ? 'ATENÇÃO: modo DEMONSTRAÇÃO (sem OPENAI_API_KEY). O áudio NÃO é transcrito de verdade.'
    : `Provedor de IA: ${provider.name}`);
});
