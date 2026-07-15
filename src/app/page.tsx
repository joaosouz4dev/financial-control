import { loadAllMonths, runDetectors } from '@/lib/demo-data'
import { summarizeMonth, formatBRL, formatMonth } from '@/lib/month-summary'
import { ThemeToggle } from '@/components/theme-toggle'
import { InsightCard } from '@/components/insight-card'
import { CategoryBar } from '@/components/category-bar'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const months = await loadAllMonths()

  if (months.length === 0) {
    return (
      <main className={styles.empty}>
        <h1>Nenhuma planilha encontrada</h1>
        <p>
          Coloque os arquivos <code>Controle Financeiro MM_AAAA.xlsx</code> em{' '}
          <code>/planilhas</code> e recarregue.
        </p>
      </main>
    )
  }

  const current = months.at(-1)!
  const previous = months.length > 1 ? months.at(-2)! : null
  const summary = summarizeMonth(current.month, current.txs, current.goals)
  const prevSummary = previous ? summarizeMonth(previous.month, previous.txs, previous.goals) : null
  const insights = runDetectors(months)

  const expenseDelta = prevSummary
    ? summary.totalExpenseCents - prevSummary.totalExpenseCents
    : null

  const upcoming = current.txs
    .filter((t) => t.kind === 'expense' && t.paidAt === null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8)

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-5 4 3 8-8" />
              <path d="M16 7h5v5" />
            </svg>
          </div>
          <div>
            <h1 className={styles.title}>Controle Financeiro</h1>
            <p className={styles.subtitle}>{formatMonth(current.month)}</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.contextChip}>Pessoal</span>
          <ThemeToggle />
        </div>
      </header>

      <main className={styles.main}>
        {/* Resumo: os numeros do RESUMO GERAL da planilha */}
        <section className={styles.stats} aria-label="Resumo do mês">
          <article className={styles.stat}>
            <span className={styles.statLabel}>Receita</span>
            <strong className={`${styles.statValue} tnum`}>{formatBRL(summary.totalIncomeCents)}</strong>
            <span className={styles.statMeta}>
              {formatBRL(summary.toReceiveCents)} a receber
            </span>
          </article>

          <article className={styles.stat}>
            <span className={styles.statLabel}>Despesa</span>
            <strong className={`${styles.statValue} tnum`}>{formatBRL(summary.totalExpenseCents)}</strong>
            {expenseDelta !== null && (
              <span
                className={`${styles.statMeta} ${expenseDelta > 0 ? styles.metaUp : styles.metaDown}`}
              >
                {expenseDelta > 0 ? '↑' : '↓'} {formatBRL(Math.abs(expenseDelta))} vs mês anterior
              </span>
            )}
          </article>

          <article className={styles.stat}>
            <span className={styles.statLabel}>A pagar</span>
            <strong className={`${styles.statValue} tnum`}>{formatBRL(summary.toPayCents)}</strong>
            <span className={styles.statMeta}>
              {formatBRL(summary.paidCents)} já pago
            </span>
          </article>

          <article className={`${styles.stat} ${styles.statHighlight}`}>
            <span className={styles.statLabel}>Previsão de saldo</span>
            <strong className={`${styles.statValue} tnum`}>
              {formatBRL(summary.projectedBalanceCents)}
            </strong>
            <span className={styles.statMeta}>
              meta de investimento: {formatBRL(summary.investmentTargetCents)}
            </span>
          </article>
        </section>

        <div className={styles.columns}>
          <div className={styles.colMain}>
            {/* O que a planilha nunca deu */}
            {insights.length > 0 && (
              <section className={styles.panel} aria-labelledby="insights-h">
                <div className={styles.panelHead}>
                  <h2 id="insights-h" className={styles.panelTitle}>
                    O que mudou
                  </h2>
                  <span className={styles.panelHint}>
                    detectado comparando {months.length} meses
                  </span>
                </div>
                <div className={styles.insightList}>
                  {insights.map((i) => (
                    <InsightCard key={i.fingerprint} insight={i} />
                  ))}
                </div>
              </section>
            )}

            {/* Metas vs realizado: a planilha calcula a meta e nunca compara */}
            <section className={styles.panel} aria-labelledby="cat-h">
              <div className={styles.panelHead}>
                <h2 id="cat-h" className={styles.panelTitle}>
                  Metas por categoria
                </h2>
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
                <h2 id="up-h" className={styles.panelTitle}>
                  A pagar
                </h2>
                <span className={styles.panelHint}>{upcoming.length} em aberto</span>
              </div>
              <ul className={styles.upList}>
                {upcoming.map((t) => (
                  <li key={t.id} className={styles.upItem}>
                    <span className={styles.upDay} aria-hidden>
                      {t.dueDate.slice(8, 10)}
                    </span>
                    <span className={styles.upDesc}>{t.description}</span>
                    <span className={`${styles.upValue} tnum`}>{formatBRL(t.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
