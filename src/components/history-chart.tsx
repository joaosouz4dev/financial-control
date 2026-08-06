'use client'

import { useState } from 'react'
import type { MonthPoint } from '@/lib/history'
import { formatBRL } from '@/lib/month-summary'
import styles from './history-chart.module.css'

/**
 * Receita vs despesa ao longo de todos os meses.
 *
 * Duas series, um unico eixo (nunca dual-axis: as duas medem reais). Legenda
 * presente porque sao 2 series, e o hover mostra o mes exato.
 */
export function HistoryChart({ points }: { points: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) {
    return <p className={styles.empty}>Preciso de ao menos dois meses para desenhar a evolução.</p>
  }

  const W = 800
  const H = 240
  const PAD = { top: 16, right: 16, bottom: 28, left: 16 }

  const max = Math.max(...points.map((p) => Math.max(p.incomeCents, p.expenseCents)), 1)

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right)
  const y = (cents: number) => PAD.top + (1 - cents / max) * (H - PAD.top - PAD.bottom)

  const line = (key: 'incomeCents' | 'expenseCents') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ')

  // Marcas de ano: onde o mes e janeiro.
  const yearTicks = points
    .map((p, i) => ({ i, year: p.month.slice(0, 4), isJan: p.month.slice(5) === '01' }))
    .filter((t) => t.isJan)

  const active = hover !== null ? points[hover] : null

  return (
    <figure className={styles.wrap}>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.income}`} aria-hidden />
          Receita
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.expense}`} aria-hidden />
          Despesa
        </span>
      </div>

      <div className={styles.plotWrap}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          role="img"
          aria-label={`Evolução de receita e despesa em ${points.length} meses, de ${points[0]!.month} a ${points.at(-1)!.month}`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-income)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--series-income)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Grid recessivo: so as marcas de ano. */}
          {yearTicks.map((t) => (
            <g key={t.year}>
              <line x1={x(t.i)} y1={PAD.top} x2={x(t.i)} y2={H - PAD.bottom} className={styles.grid} />
              <text x={x(t.i)} y={H - 8} className={styles.yearLabel} textAnchor="middle">
                {t.year}
              </text>
            </g>
          ))}

          <path
            d={`${line('incomeCents')} L ${x(points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`}
            fill="url(#incFill)"
          />

          <path d={line('expenseCents')} className={styles.lineExpense} fill="none" />
          <path d={line('incomeCents')} className={styles.lineIncome} fill="none" />

          {/* Crosshair do hover. */}
          {hover !== null && (
            <>
              <line
                x1={x(hover)}
                y1={PAD.top}
                x2={x(hover)}
                y2={H - PAD.bottom}
                className={styles.crosshair}
              />
              <circle cx={x(hover)} cy={y(points[hover]!.incomeCents)} r="4" className={styles.dotIncome} />
              <circle cx={x(hover)} cy={y(points[hover]!.expenseCents)} r="4" className={styles.dotExpense} />
            </>
          )}

          {/* Areas de hover: alvo maior que a marca. */}
          {points.map((p, i) => (
            <rect
              key={p.month}
              x={x(i) - (W - PAD.left - PAD.right) / points.length / 2}
              y={0}
              width={(W - PAD.left - PAD.right) / points.length}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {active && (
          <div className={styles.tooltip} role="status">
            <strong className={styles.ttMonth}>{formatMonthShort(active.month)}</strong>
            <span className={styles.ttRow}>
              <span className={`${styles.swatch} ${styles.income}`} aria-hidden />
              <span className="tnum">{formatBRL(active.incomeCents)}</span>
            </span>
            <span className={styles.ttRow}>
              <span className={`${styles.swatch} ${styles.expense}`} aria-hidden />
              <span className="tnum">{formatBRL(active.expenseCents)}</span>
            </span>
            <span className={`${styles.ttNet} ${active.netCents < 0 ? styles.negative : ''}`}>
              {active.netCents >= 0 ? 'sobrou ' : 'faltou '}
              <span className="tnum">{formatBRL(Math.abs(active.netCents))}</span>
            </span>
          </div>
        )}
      </div>
    </figure>
  )
}

function formatMonthShort(month: string): string {
  const [y, m] = month.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(m) - 1]}/${y}`
}
