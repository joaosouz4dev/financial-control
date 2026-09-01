import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import {
  contexts,
  recurrenceOccurrences,
  recurrenceRules,
  transactions,
} from '@/db/schema'
import { materializeOccurrences } from '@/lib/recurrence/materialize'

/**
 * Abre o mes: promove as ocorrencias previstas a lancamentos "a pagar".
 *
 * Era o gesto que o Joao fazia na mao: copiar a planilha do mes anterior,
 * limpar a coluna de pago e comecar de novo. As regras de recorrencia ja
 * sabiam o que vinha (o materializador cria 13 meses de ocorrencias), mas nada
 * transformava isso nas linhas que a tabela do mes le. Setembro virou e a tela
 * mostrou 404, porque `listMonths()` so lista mes que TEM lancamento.
 *
 * Idempotente por duas barreiras, e as duas importam:
 *
 * 1. `occurrenceId`: reabrir o mes nao duplica a linha ja criada.
 * 2. `transactionId` na ocorrencia: uma despesa que veio do import (ou que o
 *    Joao lancou na mao) ja ocupa o lugar da previsao, entao ela nao entra de
 *    novo. Sem isso, o fluxo de caixa contaria o mesmo gasto duas vezes.
 *
 * Nao mexe em mes que ja tem lancamento proprio: abrir e um gesto aditivo,
 * nunca destrutivo. Se o Joao ja lancou algo em setembro na mao, a abertura
 * soma as recorrencias que faltavam e deixa o que ele escreveu em paz.
 */

export interface OpenMonthResult {
  month: string
  created: number
  /** Ja existiam: ou de uma abertura anterior, ou do import. */
  skipped: number
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export async function openMonth(
  month: string,
  contextSlug = 'pessoal',
  /* Empurrar o horizonte custa caro (69 regras x 13 meses) e so faz diferenca
   * na primeira abertura do mes. Reabrir uma pagina ja aberta nao precisa. */
  { materialize = true }: { materialize?: boolean } = {},
): Promise<OpenMonthResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Mes invalido: "${month}"`)

  const { from, to } = monthBounds(month)

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) throw new Error(`Contexto "${contextSlug}" nao encontrado`)

  /* Empurra o horizonte antes de abrir.
   *
   * O materializador cria 13 meses de ocorrencias a partir do mes corrente, mas
   * nunca era chamado por ninguem: o horizonte era o que o backfill deixou, e
   * um dia acabaria. E idempotente pelo unique (ruleId, dueDate). */
  if (materialize) await materializeOccurrences(contextSlug)

  // Ocorrencias do mes que ainda nao viraram lancamento nem foram puladas.
  const pending = await db
    .select({
      occurrenceId: recurrenceOccurrences.id,
      dueDate: recurrenceOccurrences.dueDate,
      expectedCents: recurrenceOccurrences.expectedCents,
      installmentNo: recurrenceOccurrences.installmentNo,
      ruleId: recurrenceRules.id,
      kind: recurrenceRules.kind,
      label: recurrenceRules.label,
      categoryId: recurrenceRules.categoryId,
      accountId: recurrenceRules.accountId,
      amountExpression: recurrenceRules.amountExpression,
      installmentTotal: recurrenceRules.installmentTotal,
    })
    .from(recurrenceOccurrences)
    .innerJoin(recurrenceRules, eq(recurrenceRules.id, recurrenceOccurrences.ruleId))
    .where(
      and(
        eq(recurrenceRules.contextId, ctx.id),
        eq(recurrenceRules.active, true),
        gte(recurrenceOccurrences.dueDate, from),
        lte(recurrenceOccurrences.dueDate, to),
        isNull(recurrenceOccurrences.transactionId),
        isNull(recurrenceOccurrences.skippedAt),
      ),
    )

  if (pending.length === 0) return { month, created: 0, skipped: 0 }

  let created = 0

  for (const p of pending) {
    // A parcela mostra onde esta na serie, como na planilha: "06/25".
    const description =
      p.installmentNo && p.installmentTotal
        ? `${p.label} ${String(p.installmentNo).padStart(2, '0')}/${p.installmentTotal}`
        : p.label

    const [tx] = await db
      .insert(transactions)
      .values({
        contextId: ctx.id,
        kind: p.kind,
        amountCents: p.expectedCents,
        amountExpression: p.amountExpression,
        description,
        categoryId: p.categoryId,
        accountId: p.accountId,
        dueDate: p.dueDate,
        // Aberto e nao pago: e justamente o que o Joao vai marcar durante o mes.
        paidAt: null,
        ruleId: p.ruleId,
        occurrenceId: p.occurrenceId,
        source: 'recurrence',
      })
      .returning({ id: transactions.id })

    if (!tx) continue

    // Fecha o ciclo: a ocorrencia passa a apontar para a transacao, entao o
    // fluxo de caixa para de conta-la como previsao solta.
    await db
      .update(recurrenceOccurrences)
      .set({ transactionId: tx.id })
      .where(eq(recurrenceOccurrences.id, p.occurrenceId))

    created++
  }

  return { month, created, skipped: pending.length - created }
}
