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
cp .env.example .env.local   # preencha DATABASE_URL
pnpm dev
```

O dashboard lê os `.xlsx` de `/planilhas` enquanto o banco não está plugado,
para que a UI seja desenvolvida contra os dados reais em vez de mock.

```bash
pnpm test        # 143 testes
pnpm typecheck
pnpm build
```

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
