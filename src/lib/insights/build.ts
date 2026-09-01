import { summarizeMonth } from '@/lib/month-summary'
import { getMonthTransactions, getPriceSeries } from '@/lib/queries'
import {
  detectPriceChanges,
  detectIncomeConcentration,
  detectCatchAllCategory,
  detectGoalBreaches,
  type Insight,
} from '@/lib/insights/detectors'
import { isVolatileByNature } from '@/lib/classify'

/** Roda os detectores deterministicos sobre os dados do banco. */
export function buildInsights(
  month: string,
  summary: ReturnType<typeof summarizeMonth>,
  txs: Awaited<ReturnType<typeof getMonthTransactions>>,
  series: Awaited<ReturnType<typeof getPriceSeries>>,
): Insight[] {
  const out: Insight[] = []

  // Fatura de cartao varia por natureza: fora do detector de preco.
  out.push(...detectPriceChanges(series.filter((s) => !isVolatileByNature(s.label))))

  const incomeSources = txs
    .filter((t) => t.kind === 'income')
    .map((t) => ({ label: t.description, amountCents: t.amountCents }))
  out.push(...detectIncomeConcentration(month, incomeSources))

  out.push(
    ...detectGoalBreaches(
      month,
      summary.totalIncomeCents,
      summary.categories.map((c) => ({
        categoryId: c.slug,
        categoryName: c.name,
        spentCents: c.spentCents,
        goalPct: c.goalPct,
      })),
    ),
  )

  const outros = summary.categories.find((c) => c.slug === 'outros')
  if (outros) {
    out.push(
      ...detectCatchAllCategory(
        month,
        outros.name,
        outros.slug,
        outros.count,
        outros.spentCents,
        summary.totalIncomeCents,
        outros.goalPct,
      ),
    )
  }

  // Insight do mes atual, mais mudanca de preco que caiu neste mes.
  const relevant = out.filter((i) => {
    const m = (i.evidence as Record<string, unknown>).toMonth ?? (i.evidence as Record<string, unknown>).month
    return m === month || m === undefined
  })

  const order = { critical: 0, warn: 1, info: 2 } as const
  return relevant.sort((a, b) => order[a.severity] - order[b.severity])
}
