import { and, eq, gte, lte, sql, desc } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, categories, contexts, goals, recurrenceRules } from '@/db/schema'
import type { Tx, Goal } from './month-summary'

/** Primeiro e ultimo dia do mes 'YYYY-MM'. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export async function listMonths(contextSlug?: string): Promise<string[]> {
  const rows = await db
    .select({ month: sql<string>`to_char(${transactions.dueDate}, 'YYYY-MM')` })
    .from(transactions)
    .innerJoin(contexts, eq(contexts.id, transactions.contextId))
    .where(contextSlug ? eq(contexts.slug, contextSlug) : undefined)
    .groupBy(sql`1`)
    .orderBy(sql`1`)
  return rows.map((r) => r.month)
}

export async function getMonthTransactions(month: string, contextSlug?: string): Promise<Tx[]> {
  const { from, to } = monthRange(month)

  const rows = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amountCents: transactions.amountCents,
      description: transactions.description,
      categorySlug: categories.slug,
      categoryName: categories.name,
      dueDate: transactions.dueDate,
      paidAt: transactions.paidAt,
      contextSlug: contexts.slug,
    })
    .from(transactions)
    .innerJoin(contexts, eq(contexts.id, transactions.contextId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.dueDate, from),
        lte(transactions.dueDate, to),
        contextSlug ? eq(contexts.slug, contextSlug) : undefined,
      ),
    )
    .orderBy(transactions.dueDate)

  return rows.map((r) => ({
    ...r,
    categorySlug: r.categorySlug ?? null,
    categoryName: r.categoryName ?? null,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
  }))
}

/**
 * Metas em vigor no mes. Versionadas por effectiveFrom: um mes historico e
 * avaliado contra a meta que valia naquele mes, nao contra a meta de hoje.
 */
export async function getGoals(
  month: string,
  contextSlug = 'pessoal',
  /**
   * Investimento e destino do saldo, nao categoria de gasto: nas barras de
   * "quanto gastei por categoria" ele distorce. Mas na TELA DE METAS ele
   * precisa aparecer, porque e uma meta legitima e sem ele o total nao fecha
   * 100% como na planilha.
   */
  opts: { includeInvestment?: boolean } = {},
): Promise<Goal[]> {
  const { to } = monthRange(month)

  const rows = await db
    .select({
      categorySlug: categories.slug,
      categoryName: categories.name,
      pct: goals.pctOfIncome,
      effectiveFrom: goals.effectiveFrom,
    })
    .from(goals)
    .innerJoin(contexts, eq(contexts.id, goals.contextId))
    .innerJoin(categories, eq(categories.id, goals.categoryId))
    .where(and(eq(contexts.slug, contextSlug), lte(goals.effectiveFrom, to)))
    .orderBy(desc(goals.effectiveFrom))

  // Uma meta por categoria: a mais recente que ja estava em vigor.
  const seen = new Set<string>()
  const out: Goal[] = []
  for (const r of rows) {
    if (seen.has(r.categorySlug)) continue
    seen.add(r.categorySlug)
    // Investimento e destino do saldo, nao categoria de despesa.
    if (r.categorySlug === 'investimento' && !opts.includeInvestment) continue
    out.push({ categorySlug: r.categorySlug, categoryName: r.categoryName, pct: Number(r.pct) })
  }
  return out
}

/** Serie historica por regra: alimenta o detector de variacao de preco. */
export async function getPriceSeries(contextSlug = 'pessoal') {
  const rows = await db
    .select({
      ruleId: transactions.ruleId,
      label: recurrenceRules.label,
      month: sql<string>`to_char(${transactions.dueDate}, 'YYYY-MM')`,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .innerJoin(recurrenceRules, eq(recurrenceRules.id, transactions.ruleId))
    .innerJoin(contexts, eq(contexts.id, transactions.contextId))
    .where(and(eq(contexts.slug, contextSlug), eq(transactions.kind, 'expense')))
    .orderBy(transactions.dueDate)

  return rows
    .filter((r): r is typeof r & { ruleId: string } => r.ruleId !== null)
    .map((r) => ({ ruleId: r.ruleId, label: r.label, month: r.month, amountCents: r.amountCents }))
}

export async function listContexts() {
  return db.select().from(contexts).orderBy(contexts.slug)
}
