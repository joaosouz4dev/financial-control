'use client'

import { useState } from 'react'
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
 *
 * O hover mostra a data e o que moveu naquele dia: a curva diz que caiu, o
 * tooltip diz o que derrubou. Sem isso o mergulho e um mistero.
 */
export function CashflowChart({ projection }: { projection: Projection }) {
  const { days } = projection
  const [hover, setHover] = useState<number | null>(null)

  if (days.length === 0) {
    return <p className={styles.empty}>Sem movimento previsto neste mês.</p>
  }

  const balances = days.map((d) => d.balanceCents)
  const max = Math.max(...balances, 0)
  const min = Math.min(...balances, 0)
  const range = max - min || 1

  const W = 640
  const H = 180
  const PAD = 8
  const BOTTOM = 24

  const x = (i: number) =>
    days.length === 1 ? W / 2 : PAD + (i / (days.length - 1)) * (W - PAD * 2)
  const y = (cents: number) => PAD + (1 - (cents - min) / range) * (H - PAD - BOTTOM)

  const line = days
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.balanceCents).toFixed(1)}`)
    .join(' ')
  const area = `${line} L ${x(days.length - 1).toFixed(1)} ${y(min).toFixed(1)} L ${x(0).toFixed(1)} ${y(min).toFixed(1)} Z`
  const zeroY = y(0)

  const negative = projection.firstNegative !== null
  const last = days.at(-1)!
  const active = hover !== null ? days[hover] : null

  // Marcas de data no eixo: primeiro dia, ultimo e alguns no meio, sem colidir.
  const step = Math.max(1, Math.ceil(days.length / 6))
  const ticks = days
    .map((d, i) => ({ i, date: d.date }))
    .filter((t) => t.i % step === 0 || t.i === days.length - 1)


  const label = negative
    ? `Saldo fica negativo em ${fmtDay(projection.firstNegative!.date)}, chegando a ${formatBRL(projection.trough!.balanceCents)} em ${fmtDay(projection.trough!.date)}. Fecha o mês em ${formatBRL(projection.closingBalanceCents)}.`
    : `Saldo nunca fica negativo. Fecha o mês em ${formatBRL(projection.closingBalanceCents)}.`

  return (
    <figure className={styles.wrap}>
      <div className={styles.plotWrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        role="img"
        aria-label={label}
        onMouseLeave={() => setHover(null)}
      >
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

        {/* Datas no eixo: sem elas a curva nao diz QUANDO. */}
        {ticks.map((t) => (
          <text key={t.date} x={x(t.i)} y={H - 6} className={styles.dayLabel} textAnchor="middle">
            {fmtDay(t.date)}
          </text>
        ))}

        {/* Crosshair do hover, igual ao grafico historico. */}
        {hover !== null && (
          <>
            <line
              x1={x(hover)}
              y1={PAD}
              x2={x(hover)}
              y2={H - BOTTOM}
              className={styles.crosshair}
            />
            <circle
              cx={x(hover)}
              cy={y(days[hover]!.balanceCents)}
              r="4.5"
              className={days[hover]!.balanceCents < 0 ? styles.dotNeg : styles.dotEnd}
            />
          </>
        )}

        {/* Alvo de hover maior que a marca. */}
        {days.map((d, i) => (
          <rect
            key={`hit-${d.date}`}
            x={x(i) - (W - PAD * 2) / days.length / 2}
            y={0}
            width={Math.max((W - PAD * 2) / days.length, 6)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active && (
        <div className={styles.tooltip} role="status">
          <strong className={styles.ttDate}>{fmtFullDay(active.date)}</strong>
          <span className={`${styles.ttBalance} ${active.balanceCents < 0 ? styles.ttNeg : ''} tnum`}>
            saldo {formatBRL(active.balanceCents)}
          </span>
          {active.items.length > 0 && (
            <ul className={styles.ttItems}>
              {active.items.slice(0, 5).map((it, k) => (
                <li key={`${it.label}-${k}`} className={styles.ttItem}>
                  <span className={styles.ttLabel}>{it.label}</span>
                  <span
                    className={`${styles.ttAmount} ${it.direction === 'in' ? styles.ttIn : styles.ttOut} tnum`}
                  >
                    {it.direction === 'in' ? '+' : '-'}
                    {formatBRL(it.amountCents)}
                  </span>
                </li>
              ))}
              {active.items.length > 5 && (
                <li className={styles.ttMore}>+{active.items.length - 5} lançamentos</li>
              )}
            </ul>
          )}
        </div>
      )}
      </div>

      <figcaption className={negative ? styles.capNeg : styles.cap}>{label}</figcaption>
    </figure>
  )
}

function fmtFullDay(iso: string): string {
  const [, m, d] = iso.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${d} de ${nomes[Number(m) - 1]}`
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}
