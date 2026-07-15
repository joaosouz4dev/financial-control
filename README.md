# Controle Financeiro

Substitui as planilhas `Controle Financeiro MM_AAAA.xlsx`: histórico plurianual,
recorrência automática, metas confrontadas com o realizado e insights sobre os
dados reais.

## A regra que organiza tudo

> A LLM nunca produz um número que vai para o banco. Ela produz referências a
> números que o código valida.

| Camada | Quem faz | Pode errar? |
|---|---|---|
| Extração (texto para struct) | LLM | Sim: o código valida, você confirma |
| Detecção (dados para fatos) | SQL e TypeScript | Não: é determinístico e testado |
| Narração (fatos para conselho) | LLM | Só na prosa, nunca no dado |

A LLM aparece nas pontas. O meio, onde mora a verdade dos números, é código.

## Stack

Next.js 16 (App Router), Postgres (Neon), Drizzle ORM, Auth.js, CSS Modules.
Deploy na Vercel.

## Rodando

```bash
pnpm install
cp .env.example .env.local   # DATABASE_URL e ANTHROPIC_API_KEY
pnpm db:migrate
pnpm import:xlsx             # importa /planilhas, idempotente
pnpm dev
```

```bash
pnpm test        # 203 testes
pnpm typecheck
pnpm build
```

Para desenvolver contra Postgres local em vez do Neon, aponte a `DATABASE_URL`
para o container: o driver é escolhido pela URL (Neon fala WebSocket e trava
contra Postgres local).

## Escrita humana

Você escreve `paguei 90 de água hoje` e o sistema dá baixa no previsto em vez
de criar um lançamento duplicado. `netflix subiu pra 59,90` atualiza a regra,
não lança gasto.

Três decisões carregam o design:

**A tool pede o valor como texto**, não como número. Se pedisse número, o
modelo calcularia, e "550 por semana" viraria o que ele decidisse. Pedindo
string ele copia `550` e o TypeScript multiplica por 4 com Decimal. Isso
elimina a classe inteira de "a LLM inventou o número".

**A data é uma referência, não um calendário.** A LLM diz `{type: "today"}` e o
servidor resolve o fuso. Se pedíssemos ISO, a data de hoje teria que ir no
system prompt e invalidaria o prompt cache em todo request.

**A intenção é um campo.** Sem distinguir `record` de `price_change`, um
"netflix subiu pra 59,90" lançaria R$ 59,90 hoje e deixaria a regra em 44,90,
e o detector de variação de preço nunca dispararia.

A rota `/api/extract` não grava: propõe e devolve a evidência do casamento.
Só `/api/extract/confirm` persiste.

## Decisões de modelagem

**Dinheiro é `bigint` em centavos.** Nunca float, nunca `numeric`: este último
volta como string no driver e todo cálculo vira parse, que é onde nasce a
diferença de centavo.

**Recorrência é regra + ocorrências num horizonte rolante de 13 meses.** A regra
guarda a intenção (`Marmore, parcela 5 de 6, dia 2`), a ocorrência guarda o
estado (pago? quanto de fato?). A regra sabe onde morre, então a geração para
sozinha na parcela 25. É isto que substitui renomear `05/25` para `06/25` na mão.

**Cartão é conta, fatura é transferência.** A compra no cartão é a despesa e é
ela que bate na categoria. Pagar a fatura é transferência entre contas, e
transferência nunca entra em total de categoria. Sem essa regra o mercado conta
duas vezes: uma em Alimentação, outra dentro de "Cartão Caixa 1.808,60".

**Fórmula guarda a intenção, não só o resultado.** `=4*550` vira
`{semanas: 4, unitário: 550}` mais o valor calculado, então a UI mostra
"4 semanas x R$ 550" e deixa editar o 4. E `=2.86*6.5` é USD vezes câmbio:
guardando a taxa por ocorrência, o sistema distingue "a Microsoft aumentou" de
"o dólar subiu".

**PF/PJ é dimensão, não duplicação.** Metas e relatórios são independentes por
contexto; o consolidado é omitir o predicado de `context_id`.

## O que o importador achou nas planilhas

O `SUM()` do Excel ignora células de texto em silêncio. `A24` é a string
`"R$ 354,20"` (Escola Zaya), então o TOTAL DESPESAS exibido pela planilha
(12.831,78) subestima a despesa real em exatamente 354,20. O valor correto de
julho/2026 é 13.185,98. Há um teste que trava esse comportamento em
`src/lib/import/xlsx.test.ts`.

## Estado

Fase 1 (fundação) implementada: schema, motor de recorrência, importador,
detectores e dashboard. Faltam: persistência plugada no Neon, escrita humana
(Fase 2), narração e planos de ação (Fases 3 e 4).
