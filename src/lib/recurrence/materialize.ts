import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { db } from '@/db'
import { recurrenceRules, recurrenceOccurrences, transactions, contexts } from '@/db/schema'
import { generateOccurrences, rollingHorizon, TZ, type Rule } from './generate'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Materializa as ocorrencias das regras ativas no horizonte rolante.
 *
 * Idempotente pelo unique (ruleId, dueDate): pode rodar em cron sem medo, e
 * rodar duas vezes seguidas nao duplica nada. Esta e a peca que faz a regra
 * ("Parcela Carro, 6 de 25, dia 12") virar linhas de futuro no banco, que e o
 * que permite projetar fluxo de caixa.
 */

export interface MaterializeResult {
  rulesProcessed: number
  occurrencesCreated: number
  from: string
  to: string
}

export async function materializeOccurrences(
  contextSlug = 'pessoal',
  now = dayjs().tz(TZ),
): Promise<MaterializeResult> {
  const { from, to } = rollingHorizon(now)

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) throw new Error(`Contexto "${contextSlug}" nao encontrado`)

  const rules = await db
    .select()
    .from(recurrenceRules)
    .where(and(eq(recurrenceRules.contextId, ctx.id), eq(recurrenceRules.active, true)))

  let created = 0

  for (const r of rules) {
    const rule: Rule = {
      id: r.id,
      cadence: r.cadence,
      dayOfMonth: r.dayOfMonth,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      active: r.active,
      amountCents: r.amountCents,
      installmentCurrent: r.installmentCurrent,
      installmentTotal: r.installmentTotal,
      installmentAnchor: r.installmentAnchor,
    }

    const occ = generateOccurrences(rule, from, to)
    if (occ.length === 0) continue

    const rows = occ.map((o) => ({
      ruleId: o.ruleId,
      dueDate: o.dueDate,
      expectedCents: o.expectedCents,
      installmentNo: o.installmentNo,
    }))

    // O unique index e a barreira: reexecucao vira no-op.
    const inserted = await db
      .insert(recurrenceOccurrences)
      .values(rows)
      .onConflictDoNothing({
        target: [recurrenceOccurrences.ruleId, recurrenceOccurrences.dueDate],
      })
      .returning({ id: recurrenceOccurrences.id })

    created += inserted.length
  }

  // Ocorrencia que ja tem transacao correspondente (veio do import) aponta
  // para ela: senao o fluxo de caixa contaria o mesmo gasto duas vezes, uma
  // como previsto e outra como realizado.
  await linkExistingTransactions(ctx.id, from, to)

  return { rulesProcessed: rules.length, occurrencesCreated: created, from, to }
}

/**
 * Liga ocorrencia a transacao ja existente com mesma regra e mesma data.
 * Sem isso, julho apareceria com a despesa importada E a ocorrencia prevista.
 */
async function linkExistingTransactions(contextId: string, from: string, to: string) {
  const txs = await db
    .select({ id: transactions.id, ruleId: transactions.ruleId, dueDate: transactions.dueDate })
    .from(transactions)
    .where(
      and(
        eq(transactions.contextId, contextId),
        gte(transactions.dueDate, from),
        lte(transactions.dueDate, to),
      ),
    )

  const withRule = txs.filter((t): t is typeof t & { ruleId: string } => t.ruleId !== null)
  if (withRule.length === 0) return

  const occ = await db
    .select()
    .from(recurrenceOccurrences)
    .where(
      inArray(
        recurrenceOccurrences.ruleId,
        withRule.map((t) => t.ruleId),
      ),
    )

  const byKey = new Map(occ.map((o) => [`${o.ruleId}:${o.dueDate}`, o]))

  for (const t of withRule) {
    const o = byKey.get(`${t.ruleId}:${t.dueDate}`)
    if (o && o.transactionId === null) {
      await db
        .update(recurrenceOccurrences)
        .set({ transactionId: t.id })
        .where(eq(recurrenceOccurrences.id, o.id))
    }
  }
}
