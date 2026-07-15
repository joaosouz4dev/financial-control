import { notFound } from 'next/navigation'
import { listMonths, getMonthTransactions, getGoals, getPriceSeries } from '@/lib/queries'
import { summarizeMonth, formatBRL, formatMonth } from '@/lib/month-summary'
import { detectPriceChanges, detectIncomeConcentration, detectCatchAllCategory, detectGoalBreaches, type Insight } from '@/lib/insights/detectors'
import { isVolatileByNature } from '@/lib/classify'
import { ThemeToggle } from '@/components/theme-toggle'
import { InsightCard } from '@/components/insight-card'
import { CategoryBar } from '@/components/category-bar'
import { MonthNav } from '@/components/month-nav'
import { QuickEntry } from '@/components/quick-entry'
import { CashflowChart } from '@/components/cashflow-chart'
import { MonthSummaryCard } from '@/components/month-summary-card'
import { getFlowItems, getOpeningBalance } from '@/lib/cashflow/queries'
import { projectCashflow, upcomingCommitments } from '@/lib/cashflow/project'
import { narrateInsights, type Summary } from '@/lib/insights/narrate'
import { monthRange } from '@/lib/queries'
import Link from 'next/link'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function MonthPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  if (!/^\d{4}-\d{2}$/.test(month)) notFound()

  const months = await listMonths()
  if (!months.includes(month)) notFound()

  const [txs, goals, series] = await Promise.all([
    getMonthTransactions(month),
    getGoals(month),
    getPriceSeries(),
  ])

  const summary = summarizeMonth(month, txs, goals)

  const idx = months.indexOf(month)
  const prevMonth = idx > 0 ? months[idx - 1]! : null
  const nextMonth = idx < months.length - 1 ? months[idx + 1]! : null

  let expenseDelta: number | null = null
  if (prevMonth) {
    const prevTxs = await getMonthTransactions(prevMonth)
    const prev = summarizeMonth(prevMonth, prevTxs, goals)
    expenseDelta = summary.totalExpenseCents - prev.totalExpenseCents
  }

  const insights = buildInsights(month, summary, txs, series)

  // Fluxo de caixa: o total do mes pode fechar positivo e o saldo mergulhar no
  // dia 12. A planilha nunca mostrou isso.
  const { from, to } = monthRange(month)
  const [flowItems, opening] = await Promise.all([
    getFlowItems(from, to),
    getOpeningBalance(from),
  ])
  const projection = projectCashflow(flowItems, opening, from, to)

  const narrated = await narrateSafely(month, insights, projection)

  const upcoming = upcomingCommitments(flowItems, from, 31).slice(0, 10)

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href="/" className={styles.logo} aria-label="Início">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 17l5-5 4 3 8-8" />
              <path d="M16 7h5v5" />
            </svg>
          </Link>
          <div>
            <h1 className={styles.title}>Controle Financeiro</h1>
            <p className={styles.subtitle}>{formatMonth(month)}</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <MonthNav prev={prevMonth} next={nextMonth} />
          <span className={styles.contextChip}>Pessoal</span>
          <ThemeToggle />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.stats} aria-label="Resumo do mês">
          <article className={styles.stat}>
            <span className={styles.statLabel}>Receita</span>
            <strong className={`${styles.statValue} tnum`}>{formatBRL(summary.totalIncomeCents)}</strong>
            <span className={styles.statMeta}>{formatBRL(summary.toReceiveCents)} a receber</span>
          </article>

          <article className={styles.stat}>
            <span className={styles.statLabel}>Despesa</span>
            <strong className={`${styles.statValue} tnum`}>{formatBRL(summary.totalExpenseCents)}</strong>
            {expenseDelta !== null ? (
              <span className={`${styles.statMeta} ${expenseDelta > 0 ? styles.metaUp : styles.metaDown}`}>
                {expenseDelta > 0 ? '↑' : '↓'} {formatBRL(Math.abs(expenseDelta))} vs mês anterior
              </span>
            ) : (
              <span className={styles.statMeta}>{summary.expenseCount} lançamentos</span>
            )}
          </article>

          <article className={styles.stat}>
            <span className={styles.statLabel}>A pagar</span>
            <strong className={`${styles.statValue} tnum`}>{formatBRL(summary.toPayCents)}</strong>
            <span className={styles.statMeta}>{formatBRL(summary.paidCents)} já pago</span>
          </article>

          <article className={`${styles.stat} ${styles.statHighlight}`}>
            <span className={styles.statLabel}>Previsão de saldo</span>
            <strong className={`${styles.statValue} tnum`}>{formatBRL(summary.projectedBalanceCents)}</strong>
            <span className={styles.statMeta}>
              meta de investimento: {formatBRL(summary.investmentTargetCents)}
            </span>
          </article>
        </section>

        {narrated && (
          <MonthSummaryCard
            summary={narrated}
            insightTitles={new Map(insights.map((i) => [i.fingerprint, i.title]))}
          />
        )}

        <QuickEntry />

        <div className={styles.columns}>
          <div className={styles.colMain}>
            {insights.length > 0 && (
              <section className={styles.panel} aria-labelledby="insights-h">
                <div className={styles.panelHead}>
                  <h2 id="insights-h" className={styles.panelTitle}>O que mudou</h2>
                  <span className={styles.panelHint}>
                    {months.length} {months.length === 1 ? 'mês' : 'meses'} de histórico
                  </span>
                </div>
                <div className={styles.insightList}>
                  {insights.map((i) => (
                    <InsightCard key={i.fingerprint} insight={i} />
                  ))}
                </div>
              </section>
            )}

            <section className={styles.panel} aria-labelledby="cf-h">
              <div className={styles.panelHead}>
                <h2 id="cf-h" className={styles.panelTitle}>Fluxo de caixa</h2>
                <span className={styles.panelHint}>saldo dia a dia</span>
              </div>
              <CashflowChart projection={projection} />
            </section>

            <section className={styles.panel} aria-labelledby="cat-h">
              <div className={styles.panelHead}>
                <h2 id="cat-h" className={styles.panelTitle}>Metas por categoria</h2>
                <span className={styles.panelHint}>% sobre a receita do mês</span>
              </div>
              <div className={styles.catList}>
                {summary.categories.map((c) => (
                  <CategoryBar key={c.slug} category={c} />
                ))}
              </div>
            </section>
          </div>

          <aside className={styles.colSide}>
            <section className={styles.panel} aria-labelledby="up-h">
              <div className={styles.panelHead}>
                <h2 id="up-h" className={styles.panelTitle}>A pagar</h2>
                <span className={styles.panelHint}>{upcoming.length} em aberto</span>
              </div>
              {upcoming.length === 0 ? (
                <p className={styles.allPaid}>Tudo pago neste mês.</p>
              ) : (
                <ul className={styles.upList}>
                  {upcoming.map((t) => (
                    <li key={`${t.date}-${t.label}`} className={styles.upItem}>
                      <span className={styles.upDay} aria-hidden>{t.date.slice(8, 10)}</span>
                      <span className={styles.upDesc}>{t.label}</span>
                      <span className={`${styles.upValue} tnum`}>{formatBRL(t.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}

/**
 * A narracao e um extra: se a chave nao esta configurada ou a LLM falhou, o
 * dashboard segue com os fatos crus. Os detectores sao o produto; o conselho
 * e o acabamento.
 */
async function narrateSafely(
  month: string,
  insights: Insight[],
  projection: ReturnType<typeof projectCashflow>,
): Promise<Summary | null> {
  if (!process.env.ANTHROPIC_API_KEY || insights.length === 0) return null

  try {
    const r = await narrateInsights({
      month,
      insights,
      cashflow: {
        closingBalanceCents: projection.closingBalanceCents,
        firstNegativeDate: projection.firstNegative?.date ?? null,
        firstNegativeCents: projection.firstNegative?.balanceCents ?? null,
        troughDate: projection.trough?.date ?? null,
        troughCents: projection.trough?.balanceCents ?? null,
      },
    })
    return r.summary
  } catch (e) {
    console.error('narração falhou, seguindo sem ela:', e)
    return null
  }
}

/** Roda os detectores deterministicos sobre os dados do banco. */
function buildInsights(
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
