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
 *
 * O eixo X e o mes inteiro, dia 1 a ultimo dia, porque projectCashflow entrega
 * todos os dias. Antes so os dias com lancamento entravam na serie e o X saia
 * do indice: a curva era esticada ate as bordas e a distancia entre dois
 * pontos nao dizia quantos dias passaram. Um pulo de 5 dias parados ocupava a
 * mesma largura que um de 1 dia, e a inclinacao deixava de significar
 * velocidade de queda.
 */
export function CashflowChart({
  projection,
  today,
}: {
  projection: Projection
  /** YYYY-MM-DD no fuso do Joao. Separa o que aconteceu do que e projecao. */
  today: string
}) {
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

  /* Onde o passado termina e a projecao comeca.
   *
   * O grafico desenhava tudo com a mesma linha solida: no dia 1 do mes, os 29
   * dias seguintes pareciam fato consumado. O trecho previsto agora e
   * tracejado, e uma linha marca o hoje. */
  const idxHoje = days.findIndex((d) => d.date > today)
  const corte = idxHoje === -1 ? days.length - 1 : Math.max(0, idxHoje - 1)
  const temFuturo = idxHoje !== -1

  const linhaPassado = days
    .slice(0, corte + 1)
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.balanceCents).toFixed(1)}`)
    .join(' ')

  const linhaFuturo = temFuturo
    ? days
        .slice(corte)
        .map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(corte + i).toFixed(1)} ${y(d.balanceCents).toFixed(1)}`)
        .join(' ')
    : ''
  const area = `${line} L ${x(days.length - 1).toFixed(1)} ${y(min).toFixed(1)} L ${x(0).toFixed(1)} ${y(min).toFixed(1)} Z`
  const zeroY = y(0)

  const negative = projection.firstNegative !== null
  const last = days.at(-1)!
  const active = hover !== null ? days[hover] : null
  const inferidos = active?.items.filter((i) => i.dateInferred).length ?? 0

  // Marcas de data no eixo: dias redondos do calendario (1, 5, 10, ...) mais o
  // ultimo. Ancorar no dia e nao no indice mantem a regua legivel e estavel
  // entre meses de 28 e 31 dias.
  const step = days.length > 20 ? 5 : days.length > 10 ? 3 : 1
  const ticks = days
    .map((d, i) => ({ i, date: d.date, dia: Number(d.date.slice(8)) }))
    .filter((t) => t.dia === 1 || t.dia % step === 0 || t.i === days.length - 1)
    // O ultimo dia do mes pode encostar na marca anterior (30 e 31): descarta
    // a penultima quando elas ficariam sobrepostas.
    .filter((t, i, arr) => {
      const next = arr[i + 1]
      return !next || next.i - t.i > 1
    })


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

        {/* Realizado: linha solida. Projecao: tracejada, porque ainda nao
            aconteceu e nao deve ser lida como fato. */}
        <path d={linhaPassado} className={styles.line} fill="none" />
        {temFuturo && <path d={linhaFuturo} className={styles.lineFuture} fill="none" />}

        {temFuturo && corte >= 0 && (
          <>
            <line
              x1={x(corte)}
              y1={PAD}
              x2={x(corte)}
              y2={H - BOTTOM}
              className={styles.todayLine}
            />
            <text x={x(corte)} y={PAD - 1} className={styles.todayLabel} textAnchor="middle">
              hoje
            </text>
          </>
        )}

        {/* Dia negativo: anel na cor da superficie separa o ponto da linha. */}
        {days.map((d, i) =>
          // So o dia que MOVEU ganha marca: com o mes inteiro na serie, marcar
          // todo dia negativo desenharia uma fileira continua de bolinhas.
          d.balanceCents < 0 && d.items.length > 0 ? (
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
          {inferidos > 0 && (
            <span className={styles.ttWarn}>
              {inferidos} {inferidos === 1 ? 'previsão sem' : 'previsões sem'} dia de vencimento
              {inferidos === 1 ? ' definido, caiu' : ' definido, caíram'} aqui por padrão
            </span>
          )}
          {active.items.length > 0 && (
            <ul className={styles.ttItems}>
              {active.items.slice(0, 5).map((it, k) => (
                <li key={`${it.label}-${k}`} className={styles.ttItem}>
                  <span className={styles.ttLabel}>
                    {it.label}
                    {it.dateInferred && <span className={styles.ttInferred} title="data inferida">~</span>}
                  </span>
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
