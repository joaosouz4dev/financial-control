import Link from 'next/link'
import { getHistory } from '@/lib/history'
import { formatBRL } from '@/lib/month-summary'
import { ThemeToggle } from '@/components/theme-toggle'
import { HistoryChart } from '@/components/history-chart'
import { CategoryRanking } from '@/components/category-ranking'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function HistoricoPage() {
  const history = await getHistory()

  const anos = new Set(history.months.map((m) => m.slice(0, 4)))
  const saldoMedio = history.avgIncomeCents - history.avgExpenseCents

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href="/" className={styles.back} aria-label="Voltar ao dashboard">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className={styles.title}>Histórico</h1>
            <p className={styles.subtitle}>
              {history.months.length} meses · {anos.size} anos
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className={styles.main}>
        {history.points.length === 0 ? (
          <p className={styles.empty}>Nenhum dado ainda. Importe as planilhas.</p>
        ) : (
          <>
            <section className={styles.stats} aria-label="Médias dos últimos 12 meses">
              <article className={styles.stat}>
                <span className={styles.statLabel}>Receita média</span>
                <strong className={`${styles.statValue} tnum`}>
                  {formatBRL(history.avgIncomeCents)}
                </strong>
                <span className={styles.statMeta}>últimos 12 meses</span>
              </article>

              <article className={styles.stat}>
                <span className={styles.statLabel}>Despesa média</span>
                <strong className={`${styles.statValue} tnum`}>
                  {formatBRL(history.avgExpenseCents)}
                </strong>
                <span className={styles.statMeta}>últimos 12 meses</span>
              </article>

              <article className={`${styles.stat} ${saldoMedio >= 0 ? styles.statGood : styles.statBad}`}>
                <span className={styles.statLabel}>Sobra média</span>
                <strong className={`${styles.statValue} tnum`}>{formatBRL(saldoMedio)}</strong>
                <span className={styles.statMeta}>por mês</span>
              </article>
            </section>

            <section className={styles.panel} aria-labelledby="evo-h">
              <div className={styles.panelHead}>
                <h2 id="evo-h" className={styles.panelTitle}>
                  Receita e despesa ao longo do tempo
                </h2>
                <span className={styles.panelHint}>passe o mouse para ver o mês</span>
              </div>
              <HistoryChart points={history.points} />
            </section>

            {(history.bestMonth || history.worstMonth) && (
              <section className={styles.extremes} aria-label="Melhor e pior mês">
                {history.bestMonth && (
                  <article className={styles.extreme}>
                    <span className={styles.extremeLabel}>Melhor mês</span>
                    <strong className={styles.extremeMonth}>
                      {formatMonthLong(history.bestMonth.month)}
                    </strong>
                    <span className={`${styles.extremeValue} ${styles.good} tnum`}>
                      +{formatBRL(history.bestMonth.netCents)}
                    </span>
                  </article>
                )}
                {history.worstMonth && (
                  <article className={styles.extreme}>
                    <span className={styles.extremeLabel}>Pior mês</span>
                    <strong className={styles.extremeMonth}>
                      {formatMonthLong(history.worstMonth.month)}
                    </strong>
                    <span className={`${styles.extremeValue} ${styles.bad} tnum`}>
                      {formatBRL(history.worstMonth.netCents)}
                    </span>
                  </article>
                )}
              </section>
            )}

            <section className={styles.panel} aria-labelledby="cat-h">
              <div className={styles.panelHead}>
                <h2 id="cat-h" className={styles.panelTitle}>
                  Onde o dinheiro foi
                </h2>
                <span className={styles.panelHint}>total acumulado por categoria</span>
              </div>
              <CategoryRanking categories={history.categories} monthCount={history.months.length} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function formatMonthLong(month: string): string {
  const [y, m] = month.split('-')
  const nomes = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ]
  return `${nomes[Number(m) - 1]} de ${y}`
}
