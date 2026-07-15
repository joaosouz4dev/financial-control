import type { Insight } from '@/lib/insights/detectors'
import { formatBRL } from '@/lib/month-summary'
import styles from './insight-card.module.css'

/**
 * Todo insight mostra a evidencia que o gerou. Esta e a regra do produto:
 * a afirmacao vem sempre acompanhada do dado que a prova.
 */
export function InsightCard({ insight }: { insight: Insight }) {
  const e = insight.evidence as Record<string, any>

  return (
    <article className={`${styles.card} ${styles[insight.severity]}`}>
      <span className={styles.stripe} aria-hidden />
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.badge}>{labelFor(insight.type)}</span>
          {insight.severity === 'critical' && <span className={styles.sev}>atenção</span>}
        </div>
        <p className={styles.title}>{insight.title}</p>
        <p className={styles.evidence}>{evidenceLine(insight.type, e)}</p>
      </div>
    </article>
  )
}

function labelFor(type: string): string {
  const map: Record<string, string> = {
    price_change: 'preço mudou',
    fx_change: 'câmbio',
    goal_exceeded: 'meta estourada',
    income_concentration: 'concentração',
    anomaly: 'fora do padrão',
    orphan_subscription: 'assinatura',
    negative_cashflow: 'fluxo de caixa',
    catch_all_category: 'categoria',
  }
  return map[type] ?? type
}

/** A evidencia em uma linha: numeros reais, nunca adjetivo. */
function evidenceLine(type: string, e: Record<string, any>): string {
  switch (type) {
    case 'price_change':
    case 'fx_change':
      return `${e.fromMonth} → ${e.toMonth} · impacto de ${formatBRL(Math.abs(e.annualImpactCents))} por ano`
    case 'income_concentration':
      return (e.topSources as any[])
        .map((s) => `${s.label}: ${formatBRL(s.amountCents)} (${s.sharePct}%)`)
        .join(' · ')
    case 'catch_all_category':
      return `${e.itemCount} lançamentos somam ${formatBRL(e.spentCents)}, contra meta de ${e.goalPct}% da receita`
    case 'goal_exceeded':
      return `${formatBRL(e.spentCents)} gastos contra meta de ${formatBRL(e.goalCents)}`
    case 'anomaly':
      return `mediana histórica: ${formatBRL(e.medianCents)} · agora: ${formatBRL(e.currentCents)}`
    case 'orphan_subscription':
      return `${formatBRL(e.annualCents)} por ano · sem sinal de uso há ${e.monthsSinceSignal} meses`
    case 'negative_cashflow':
      return `pior momento: ${formatBRL(e.worstCents)} em ${e.worstDate}`
    default:
      return ''
  }
}
