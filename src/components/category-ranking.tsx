import type { CategorySeries } from '@/lib/history'
import { formatBRL } from '@/lib/month-summary'
import styles from './category-ranking.module.css'

/**
 * Total gasto por categoria em todo o historico.
 *
 * Magnitude, nao identidade: todas as barras usam a MESMA cor, e o comprimento
 * carrega a informacao. Sete cores diferentes aqui seriam ruido, porque a
 * pergunta e "qual e maior", nao "qual e qual".
 */
export function CategoryRanking({
  categories,
  monthCount,
}: {
  categories: CategorySeries[]
  monthCount: number
}) {
  if (categories.length === 0) {
    return <p className={styles.empty}>Sem categorias no histórico.</p>
  }

  const max = Math.max(...categories.map((c) => c.totalCents), 1)

  return (
    <ul className={styles.list}>
      {categories.map((c) => {
        const pct = (c.totalCents / max) * 100
        const perMonth = Math.round(c.totalCents / Math.max(monthCount, 1))
        return (
          <li key={c.slug} className={styles.row}>
            <div className={styles.top}>
              <span className={styles.name}>{c.name}</span>
              <span className={`${styles.total} tnum`}>{formatBRL(c.totalCents)}</span>
            </div>
            <div
              className={styles.track}
              role="meter"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${c.name}: ${formatBRL(c.totalCents)} no total`}
            >
              <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.perMonth}>
              <span className="tnum">{formatBRL(perMonth)}</span> por mês em média
            </span>
          </li>
        )
      })}
    </ul>
  )
}
