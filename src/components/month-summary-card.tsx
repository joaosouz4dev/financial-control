import type { Summary } from '@/lib/insights/narrate'
import styles from './month-summary-card.module.css'

/**
 * O resumo narrado. So aparece quando a LLM escreveu de verdade: se a chave
 * nao esta configurada ou a narracao falhou, o dashboard segue sem ele, com os
 * insights crus. O conselho e um extra, os fatos e que sao o produto.
 */
export function MonthSummaryCard({
  summary,
  insightTitles,
}: {
  summary: Summary
  insightTitles: Map<string, string>
}) {
  return (
    <section className={styles.wrap} aria-labelledby="sum-h">
      <div className={styles.head}>
        <h2 id="sum-h" className={styles.eyebrow}>
          Resumo do mês
        </h2>
        <span className={styles.hint}>escrito sobre os fatos verificados</span>
      </div>

      <p className={styles.headline}>{summary.headline}</p>
      <p className={styles.body}>{summary.body}</p>

      {summary.actions.length > 0 && (
        <ul className={styles.actions}>
          {summary.actions.map((a) => (
            <li key={a.basedOn + a.text} className={styles.action}>
              <span className={styles.dot} aria-hidden />
              <div className={styles.actionBody}>
                <span className={styles.actionText}>{a.text}</span>
                {/* A acao cita o fato que a sustenta: sem evidencia, nao entra. */}
                <span className={styles.basis}>{insightTitles.get(a.basedOn) ?? a.basedOn}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
