import type { CategoryLine } from '@/lib/month-summary'
import { formatBRL } from '@/lib/month-summary'
import styles from './category-bar.module.css'

/**
 * Meta vs realizado. O estado vive na forma alem do numero: a barra passa do
 * trilho quando estoura, entao da para ler de relance sem conferir digito.
 */
export function CategoryBar({ category: c }: { category: CategoryLine }) {
  const usage = c.usagePct ?? 0
  const over = usage > 100
  const width = Math.min(usage, 100)
  const overflow = over ? Math.min(usage - 100, 100) : 0

  return (
    <div className={styles.row}>
      <div className={styles.top}>
        <span className={styles.name}>{c.name}</span>
        {c.count > 0 && <span className={styles.count}>{c.count}</span>}
        <span className={`${styles.value} tnum`}>{formatBRL(c.spentCents)}</span>
      </div>

      <div
        className={styles.track}
        role="meter"
        aria-valuenow={Math.round(usage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${c.name}: ${Math.round(usage)}% da meta`}
      >
        <div
          className={`${styles.fill} ${over ? styles.fillOver : ''}`}
          style={{ width: `${width}%` }}
        />
        {over && <div className={styles.overflow} style={{ width: `${overflow}%` }} />}
      </div>

      <div className={styles.bottom}>
        {c.goalCents !== null ? (
          <>
            <span className={over ? styles.overText : styles.metaText}>
              {Math.round(usage)}% da meta
            </span>
            <span className={`${styles.goal} tnum`}>
              meta {formatBRL(c.goalCents)} ({c.goalPct}%)
            </span>
          </>
        ) : (
          <span className={styles.noGoal}>sem meta definida</span>
        )}
      </div>
    </div>
  )
}
