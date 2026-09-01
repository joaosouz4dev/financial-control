import { notFound } from 'next/navigation'
import { listMonths, getMonthTransactions, getGoals, getPriceSeries } from '@/lib/queries'
import { summarizeMonth, formatBRL, formatMonth } from '@/lib/month-summary'
import { detectPriceChanges, detectIncomeConcentration, detectCatchAllCategory, detectGoalBreaches, type Insight } from '@/lib/insights/detectors'
import { isVolatileByNature } from '@/lib/classify'
import { AppHeader } from '@/components/app-header'
import { InsightCard } from '@/components/insight-card'
import { CategoryBar } from '@/components/category-bar'
import { MonthNav } from '@/components/month-nav'
import { CashflowChart } from '@/components/cashflow-chart'
import { LedgerTable } from '@/components/ledger-table'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { TZ } from '@/lib/nl/resolve'

dayjs.extend(utc)
dayjs.extend(timezone)
import { getLedger } from '@/lib/ledger'
import { openMonth } from '@/lib/month/open'
import { getFlowItems, getOpeningBalance } from '@/lib/cashflow/queries'
import { projectCashflow } from '@/lib/cashflow/project'
import { buildInsights } from '@/lib/insights/build'
import { LedgerProvider } from '@/components/ledger-store'
import { MonthStats } from '@/components/month-stats'
import { MonthNarration } from '@/components/month-narration'
import { monthRange } from '@/lib/queries'
import Link from 'next/link'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function MonthPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  if (!/^\d{4}-\d{2}$/.test(month)) notFound()

  let months = await listMonths()

  /* Mes que ainda nao existe: abre antes de decidir que e 404.
   *
   * Era aqui que virar o mes dava 404. As recorrencias de setembro ja estavam
   * previstas no banco, mas nenhum lancamento existia, entao `listMonths()` nao
   * listava setembro e a pagina nem carregava. Abrir promove as previsoes a
   * linhas "a pagar", como copiar a planilha do mes anterior fazia.
   *
   * So vale para o mes corrente ou futuro: abrir um mes passado que ficou vazio
   * inventaria historico que nunca aconteceu. */
  if (!months.includes(month)) {
    const atual = dayjs().tz(TZ).format('YYYY-MM')
    if (month < atual) notFound()

    const { created } = await openMonth(month)
    if (created === 0) notFound()

    months = await listMonths()
  }

  const idx = months.indexOf(month)
  const prevMonth = idx > 0 ? months[idx - 1]! : null
  const nextMonth = idx < months.length - 1 ? months[idx + 1]! : null

  /* Tudo de uma vez. Antes o mes anterior era buscado sozinho, entre dois
   * blocos paralelos, e sozinho custava o tempo de uma ida ao banco inteira.
   * Como cada refresh da tabela re-renderiza a pagina, isso pesava em toda
   * mudanca. */
  const { from, to } = monthRange(month)
  const [txs, goals, series, prevTxs, flowItems, opening, ledger] = await Promise.all([
    getMonthTransactions(month),
    getGoals(month),
    getPriceSeries(),
    prevMonth ? getMonthTransactions(prevMonth) : Promise.resolve(null),
    getFlowItems(from, to),
    getOpeningBalance(from),
    getLedger(month),
  ])

  const summary = summarizeMonth(month, txs, goals)

  const expenseDelta =
    prevMonth && prevTxs
      ? summary.totalExpenseCents - summarizeMonth(prevMonth, prevTxs, goals).totalExpenseCents
      : null

  const insights = buildInsights(month, summary, txs, series)
  const projection = projectCashflow(flowItems, opening, from, to)


  return (
    <div className={styles.shell}>
      <AppHeader title="Controle Financeiro" subtitle={formatMonth(month)}>
        <MonthNav prev={prevMonth} next={nextMonth} />
      </AppHeader>

      <main className={styles.main}>
        <LedgerProvider ledger={ledger}>
          <MonthStats
            expenseDelta={expenseDelta}
            investmentTargetCents={summary.investmentTargetCents}
          />

        <MonthNarration month={month} />


          <section aria-label="Lançamentos do mês">
            {/* "Hoje" e resolvido no servidor, no fuso do Joao: o relogio do
                browser pode estar em outro fuso e pintaria a linha errada. */}
            <LedgerTable month={month} today={dayjs().tz(TZ).format('YYYY-MM-DD')} />
          </section>
        </LedgerProvider>

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
        </div>
      </main>
    </div>
  )
}
