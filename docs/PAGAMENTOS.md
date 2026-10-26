# Cobrança do Confere: comparação de opções (Etapa 3)

> **Limite desta pesquisa:** não foi possível abrir as páginas oficiais de preço (rede restrita). Abaixo vai só o que as buscas confirmaram; **todas as taxas precisam ser conferidas nas páginas oficiais** antes de decidir. Nada aqui é aconselhamento fiscal ou jurídico.

## O que o Confere precisa

1. Assinatura mensal (planos Intermediário e Premium), com renovação automática.
2. Teste gratuito de 7 dias **sem cartão** (já é feito no nosso banco, não depende do gateway).
3. Compra avulsa de **minutos extras** (pagamento único).
4. Pix e cartão (o público brasileiro espera Pix); boleto é opcional.
5. Aviso automático (webhook) quando o pagamento é aprovado, falha ou a assinatura é cancelada, para liberar/bloquear a conta e creditar minutos (`grant_extra_seconds`).
6. Emissão de nota fiscal de serviço: confirme com seu contador quais as obrigações e se o gateway ajuda.

## Comparação (fontes ao final)

| | Stripe | Asaas | Mercado Pago | Paddle / Lemon Squeezy (merchant of record) |
|---|---|---|---|---|
| Assinatura recorrente por API | Sim (Billing) | Sim: boleto, Pix e cartão, com cobranças geradas sozinhas | Sim: planos e assinaturas; Pix, cartão, boleto listados | Sim |
| Pix | Sim, em reais (desde ago/2025, parceria com EBANX); Pix recorrente documentado (mandato do cliente; IOF incide por transação) | Sim; **Pix Automático** (autorização única e cobranças futuras) | Sim, listado para recorrência | Não confirmado para o Brasil |
| Cartão | Sim | Sim | Sim | Sim |
| Taxas | **A verificar** (stripe.com/br/pricing) | **A verificar** (página de preços do Asaas) | Página de vendas mostrou 4,49% crédito e 4,99% débito, e uma oferta de 9,99% (promocional?). **A verificar**, inclusive Pix | 5% + US$0,50 em ambos (fontes de terceiros). Lemon Squeezy migrando para Stripe Managed Payments (3,5% + taxas da Stripe). **A verificar** |
| Pontos fortes (pelo que se encontrou) | Documentação e ferramentas maduras; checkout hospedado e portal do cliente reduzem muito o código | Brasileiro, documentação em português, foco em recorrência local | Marca muito conhecida do consumidor brasileiro | Cuidam de impostos de venda no exterior |
| Pontos de atenção | Repasse de 30 dias citado em um guia (**não confirmado**); nota fiscal fica por sua conta | Verificar taxas, prazo de recebimento e emissão de nota | Verificar taxas por meio de pagamento e prazos | Pouca relevância para vender em reais no Brasil; fiscalidade brasileira **não encontrada** |

## Recomendação provisória

1. **Stripe (Billing + Checkout + Portal do cliente)** como primeira opção: é o caminho que menos código exige (teste, upgrade, cancelamento e troca de cartão no portal hospedado) e já cobre Pix e cartão. Condição: conseguir abrir conta no Brasil e confirmar as taxas.
2. **Asaas** como alternativa forte se o Pix/boleto for o meio dominante dos seus clientes, se quiser suporte local em português ou se a Stripe não aprovar a conta.
3. Mercado Pago faz sentido como segunda forma de pagamento; evite duas integrações no início.
4. Paddle/Lemon Squeezy: só se for vender internacionalmente.

## Como o desenho já suporta qualquer escolha

- `subscriptions.provider` / `provider_ref` guardam qual gateway e qual assinatura.
- Um endpoint de webhook por gateway atualiza `subscriptions` (status, `period_start`/`period_end`) com a chave de serviço.
- Minutos extras: pagamento único → webhook → `grant_extra_seconds(user, segundos, nota)`.
- Renovação: ao confirmar o pagamento do mês, o webhook avança `period_start`/`period_end` (o saldo do plano recomeça sozinho, pois é contado por período).

## Antes de escolher, calcule

Margem por usuário = mensalidade − taxa do gateway − (custo de transcrição + resumo por minuto × minutos do plano) − impostos. Use os preços atuais da OpenAI e a franquia de cada plano. Os minutos do Intermediário e do Premium no banco são **provisórios**.

## Fontes

- [Stripe: Pix recorrente](https://docs.stripe.com/payments/pix/accept-a-recurring-payment) · [Stripe: Pix e IOF (changelog)](https://edge-docs.stripe.com/changelog/basil/2025-08-27/pix-payments-iof-tax) · [Pix na Stripe (Payment Expert)](https://paymentexpert.com/2025/08/12/stripe-pix-brtazil-latin-america/)
- [Asaas: assinaturas](https://docs.asaas.com/docs/assinaturas-recorrência) · [Asaas: Pix Automático x Assinaturas](https://docs.asaas.com/docs/diferença-entre-pix-automático-e-assinaturas)
- [Mercado Pago: assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview) · [Mercado Pago: ferramentas de assinaturas](https://www.mercadopago.com.br/ferramentas-para-vender/assinaturas?code=1H1A5)
- [Paddle vs Lemon Squeezy](https://resources.rework.com/tools/billing-revenue/paddle-vs-lemon-squeezy) · [Gateways no Brasil](https://learnwithhasan.com/payment-gateways/country/brazil/)
