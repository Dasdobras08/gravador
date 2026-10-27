// Provedor de DEMONSTRAÇÃO. Não processa o áudio enviado: devolve um exemplo fixo,
// sempre marcado como demonstração na interface. Serve apenas para testar o fluxo.

export const DEMO_NOTICE =
  'MODO DEMONSTRAÇÃO: este conteúdo é um exemplo fixo e NÃO vem do seu áudio. ' +
  'Configure OPENAI_API_KEY para transcrição e resumo reais.';

const SEGMENTS = [
  [0, 6, '[Exemplo] Pessoa A: Vamos começar revendo o andamento do projeto de exemplo.'],
  [6, 13, '[Exemplo] Pessoa B: A fase de testes terminou e encontramos poucos problemas.'],
  [13, 21, '[Exemplo] Pessoa A: Então decidimos publicar a versão de exemplo na próxima etapa.'],
  [21, 29, '[Exemplo] Pessoa B: Eu envio o relatório de testes ao grupo até sexta-feira.'],
  [29, 36, '[Exemplo] Pessoa A: Ainda não definimos quem vai atualizar a documentação.'],
];

export const demoProvider = {
  name: 'demo',
  demo: true,
  async transcribe() {
    return SEGMENTS.map(([start, end, text]) => ({ start, end, text }));
  },
  async summarize() {
    return {
      overview: '(Demonstração) Exemplo fixo de resumo; não corresponde ao áudio enviado.',
      topics: [
        { title: 'Andamento do projeto (exemplo)', points: [
          { text: 'A fase de testes terminou com poucos problemas.', origin: 'dito', evidence: [1] },
        ] },
      ],
      decisions: [{ text: 'Publicar a versão de exemplo na próxima etapa.', origin: 'dito', evidence: [2] }],
      tasks: [
        { text: 'Enviar o relatório de testes ao grupo.', owner: 'Pessoa B', deadline: 'sexta-feira',
          deadline_quote: 'sexta-feira', origin: 'dito', evidence: [3] },
        { text: 'Definir quem atualizará a documentação (responsável não definido na conversa).', owner: null,
          deadline: null, origin: 'dito', evidence: [4] },
        { text: 'Sugestão: registrar a data de publicação no calendário do grupo.', origin: 'sugestao_ia', evidence: [] },
      ],
      warnings: [DEMO_NOTICE],
    };
  },
};
