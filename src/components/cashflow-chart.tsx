import type { Projection } from '@/lib/cashflow/project'
import { formatBRL } from '@/lib/month-summary'
import styles from './cashflow-chart.module.css'

/**
 * A curva de saldo do mes.
 *
 * A planilha da um numero so ("Previsao Saldo Final") e esconde o mergulho no
 * meio do mes. Aqui o zero e uma linha real: o que cai abaixo dela se le pela
 * forma, nao so pelo numero.
 *
 * O viewBox usa proporcao real (sem preserveAspectRatio="none"): esticar o SVG
 * distorceria a espessura da linha e a inclinacao, que sao justamente o que
 * comunica a queda.
 */
export function CashflowChart({ projection }: { projection: Projection }) {
  const { days } = projection
  if (days.length === 0) {
    return <p className={styles.empty}>Sem movimento previsto neste mês.</p>
  }

  const balances = days.map((d) => d.balanceCents)
  const max = Math.max(...balances, 0)
  const min = Math.min(...balances, 0)
  const range = max - min || 1

  const W = 640
  const H = 160
  const PAD = 8

  const x = (i: number) =>
    days.length === 1 ? W / 2 : PAD + (i / (days.length - 1)) * (W - PAD * 2)
  const y = (cents: number) => PAD + (1 - (cents - min) / range) * (H - PAD * 2)

  const line = days
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.balanceCents).toFixed(1)}`)
    .join(' ')
  const area = `${line} L ${x(days.length - 1).toFixed(1)} ${y(min).toFixed(1)} L ${x(0).toFixed(1)} ${y(min).toFixed(1)} Z`
  const zeroY = y(0)

  const negative = projection.firstNegative !== null
  const last = days.at(-1)!

  const label = negative
    ? `Saldo fica negativo em ${fmtDay(projection.firstNegative!.date)}, chegando a ${formatBRL(projection.trough!.balanceCents)} em ${fmtDay(projection.trough!.date)}. Fecha o mês em ${formatBRL(projection.closingBalanceCents)}.`
    : `Saldo nunca fica negativo. Fecha o mês em ${formatBRL(projection.closingBalanceCents)}.`

  return (
    <figure className={styles.wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={label}>
        <defs>
          <linearGradient id="cfFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#cfFill)" />

        {/* O zero e a unica referencia que importa aqui. */}
        {min < 0 && <line x1="0" y1={zeroY} x2={W} y2={zeroY} className={styles.zero} />}

        <path d={line} className={styles.line} fill="none" />

        {/* Dia negativo: anel na cor da superficie separa o ponto da linha. */}
        {days.map((d, i) =>
          d.balanceCents < 0 ? (
            <circle key={d.date} cx={x(i)} cy={y(d.balanceCents)} r="4" className={styles.dotNeg} />
          ) : null,
        )}

        <circle cx={x(days.length - 1)} cy={y(last.balanceCents)} r="5" className={styles.dotEnd} />
      </svg>

      <figcaption className={negative ? styles.capNeg : styles.cap}>{label}</figcaption>
    </figure>
  )
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}
