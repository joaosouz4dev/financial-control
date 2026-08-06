import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, categories, contexts } from '@/db/schema'

/**
 * Series historicas cruzando TODOS os meses.
 *
 * E a pergunta que a planilha nunca conseguiu responder, porque cada mes era
 * um arquivo isolado: "como isso evoluiu?". Tudo agregado em SQL, sem LLM.
 */

export interface MonthPoint {
  month: string
  incomeCents: number
  expenseCents: number
  netCents: number
}

export interface CategorySeries {
  slug: string
  name: string
  /** Total por mes, na mesma ordem de `months`. */
  byMonth: number[]
  totalCents: number
}

export interface History {
  months: string[]
  points: MonthPoint[]
  categories: CategorySeries[]
  /** Media mensal dos ultimos 12 meses com dado. */
  avgIncomeCents: number
  avgExpenseCents: number
  bestMonth: MonthPoint | null
  worstMonth: MonthPoint | null
}

export async function getHistory(contextSlug = 'pessoal'): Promise<History> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) {
    return {
      months: [],
      points: [],
      categories: [],
      avgIncomeCents: 0,
      avgExpenseCents: 0,
      bestMonth: null,
      worstMonth: null,
    }
  }

  // Transferencia nao entra: e dinheiro trocando de bolso, nao receita nem
  // despesa. A mesma regra anti-dupla-contagem do resto do app.
  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.dueDate}, 'YYYY-MM')`,
      incomeCents: sql<string>`coalesce(sum(case when ${transactions.kind}='income' then ${transactions.amountCents} else 0 end), 0)`,
      expenseCents: sql<string>`coalesce(sum(case when ${transactions.kind}='expense' then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.contextId, ctx.id), sql`${transactions.kind} <> 'transfer'`))
    .groupBy(sql`1`)
    .orderBy(sql`1`)

  const points: MonthPoint[] = rows.map((r) => {
    const income = Number(r.incomeCents)
    const expense = Number(r.expenseCents)
    return { month: r.month, incomeCents: income, expenseCents: expense, netCents: income - expense }
  })

  const months = points.map((p) => p.month)

  // Serie por categoria, so despesa (receita nao tem categoria no modelo dele).
  const catRows = await db
    .select({
      month: sql<string>`to_char(${transactions.dueDate}, 'YYYY-MM')`,
      slug: categories.slug,
      name: categories.name,
      cents: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.contextId, ctx.id), eq(transactions.kind, 'expense')))
    .groupBy(sql`1, 2, 3`)
    .orderBy(sql`1`)

  const monthIndex = new Map(months.map((m, i) => [m, i]))
  const bySlug = new Map<string, CategorySeries>()

  for (const r of catRows) {
    let series = bySlug.get(r.slug)
    if (!series) {
      series = { slug: r.slug, name: r.name, byMonth: new Array(months.length).fill(0), totalCents: 0 }
      bySlug.set(r.slug, series)
    }
    const i = monthIndex.get(r.month)
    if (i !== undefined) {
      const cents = Number(r.cents)
      series.byMonth[i] = cents
      series.totalCents += cents
    }
  }

  const categoriesOut = [...bySlug.values()].sort((a, b) => b.totalCents - a.totalCents)

  // Media dos ultimos 12 meses: representa o momento atual melhor que a media
  // de 4 anos, que dilui a mudanca de padrao.
  const recent = points.slice(-12)
  const avgIncome = recent.length
    ? Math.round(recent.reduce((s, p) => s + p.incomeCents, 0) / recent.length)
    : 0
  const avgExpense = recent.length
    ? Math.round(recent.reduce((s, p) => s + p.expenseCents, 0) / recent.length)
    : 0

  const withNet = points.filter((p) => p.incomeCents > 0 || p.expenseCents > 0)
  const best = withNet.length
    ? withNet.reduce((b, p) => (p.netCents > b.netCents ? p : b), withNet[0]!)
    : null
  const worst = withNet.length
    ? withNet.reduce((w, p) => (p.netCents < w.netCents ? p : w), withNet[0]!)
    : null

  return {
    months,
    points,
    categories: categoriesOut,
    avgIncomeCents: avgIncome,
    avgExpenseCents: avgExpense,
    bestMonth: best,
    worstMonth: worst,
  }
}
