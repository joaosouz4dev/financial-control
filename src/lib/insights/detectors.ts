/**
 * Motor de insights DETERMINISTICO.
 *
 * Nenhuma LLM aqui. Estas funcoes sao a fonte de verdade: se um detector diz
 * que a Netflix subiu 33%, isso e aritmetica sobre o banco, nao geracao de
 * texto. A LLM depois narra o que estes detectores provaram, e so isso.
 *
 * Toda funcao e pura: entra dado, sai fato. Da para testar sem banco.
 */

export type Severity = 'info' | 'warn' | 'critical'

export interface Insight {
  type: string
  severity: Severity
  /** Dedup: o mesmo insight nao reaparece todo dia. */
  fingerprint: string
  title: string
  evidence: Record<string, unknown>
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1).replace('.', ',')}%`

// ---------------------------------------------------------------------------
// 1. Variacao de preco de recorrencia
// ---------------------------------------------------------------------------

export interface PricePoint {
  ruleId: string
  label: string
  month: string // YYYY-MM
  amountCents: number
  fxRate?: number | null
}

export interface PriceChangeOptions {
  /** Ignora ruido: variacao menor que isso nao vira insight. */
  minPctChange?: number
  /** Ignora centavos: variacao absoluta menor que isso nao importa. */
  minAbsCents?: number
}

/**
 * Netflix 44,90 -> 59,90 = +33,4%.
 *
 * Quando ha cambio, separa "o fornecedor aumentou" de "o dolar subiu":
 * se o valor em moeda estrangeira nao mudou, a culpa e do cambio.
 */
export function detectPriceChanges(
  points: PricePoint[],
  opts: PriceChangeOptions = {},
): Insight[] {
  const { minPctChange = 5, minAbsCents = 500 } = opts
  const out: Insight[] = []

  const byRule = new Map<string, PricePoint[]>()
  for (const p of points) {
    const arr = byRule.get(p.ruleId) ?? []
    arr.push(p)
    byRule.set(p.ruleId, arr)
  }

  for (const [ruleId, series] of byRule) {
    const sorted = [...series].sort((a, b) => a.month.localeCompare(b.month))
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const curr = sorted[i]!
      if (prev.amountCents === curr.amountCents) continue

      const deltaCents = curr.amountCents - prev.amountCents
      const deltaPct = (deltaCents / prev.amountCents) * 100

      // Cambio explica a variacao? Isto e classificacao, nao filtro de ruido,
      // entao roda ANTES dos thresholds: uma assinatura em dolar pode variar
      // poucos reais e ainda assim precisar ser rotulada como cambio.
      let fxDriven = false
      if (prev.fxRate && curr.fxRate && prev.fxRate !== curr.fxRate) {
        const expectedFromFx = Math.round(prev.amountCents * (curr.fxRate / prev.fxRate))
        // Se o previsto pelo cambio explica quase tudo, nao e aumento de preco.
        fxDriven = Math.abs(expectedFromFx - curr.amountCents) < Math.abs(deltaCents) * 0.2
      }

      if (Math.abs(deltaPct) < minPctChange) continue
      // Variacao cambial fica isenta do piso absoluto: o valor em reais e
      // pequeno por natureza, mas a explicacao ainda importa.
      if (!fxDriven && Math.abs(deltaCents) < minAbsCents) continue

      out.push({
        type: fxDriven ? 'fx_change' : 'price_change',
        severity: Math.abs(deltaPct) >= 20 ? 'warn' : 'info',
        fingerprint: `price_change:${ruleId}:${curr.month}`,
        title: fxDriven
          ? `${curr.label}: ${brl(curr.amountCents)} por causa do câmbio (${pct(deltaPct)})`
          : `${curr.label} passou de ${brl(prev.amountCents)} para ${brl(curr.amountCents)} (${pct(deltaPct)})`,
        evidence: {
          ruleId,
          label: curr.label,
          fromMonth: prev.month,
          toMonth: curr.month,
          fromCents: prev.amountCents,
          toCents: curr.amountCents,
          deltaCents,
          deltaPct: Number(deltaPct.toFixed(2)),
          fxDriven,
          annualImpactCents: deltaCents * 12,
        },
      })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// 2. Meta de categoria estourada
// ---------------------------------------------------------------------------

export interface CategorySpend {
  categoryId: string
  categoryName: string
  spentCents: number
  goalPct: number | null
}

/**
 * Confronta o realizado com a meta percentual sobre a receita. A planilha
 * calcula a meta em R$ e nunca compara com o gasto real.
 */
export function detectGoalBreaches(
  month: string,
  incomeCents: number,
  spends: CategorySpend[],
  tolerancePct = 10,
): Insight[] {
  if (incomeCents <= 0) return []
  const out: Insight[] = []

  for (const s of spends) {
    if (s.goalPct === null) continue
    const goalCents = Math.round((incomeCents * s.goalPct) / 100)
    if (goalCents <= 0) continue

    const overCents = s.spentCents - goalCents
    const overPct = (overCents / goalCents) * 100
    if (overPct <= tolerancePct) continue

    out.push({
      type: 'goal_exceeded',
      severity: overPct >= 50 ? 'critical' : 'warn',
      fingerprint: `goal_exceeded:${s.categoryId}:${month}`,
      title: `${s.categoryName}: ${brl(s.spentCents)} contra meta de ${brl(goalCents)} (${pct(overPct)})`,
      evidence: {
        month,
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        spentCents: s.spentCents,
        goalCents,
        goalPct: s.goalPct,
        overCents,
        overPct: Number(overPct.toFixed(2)),
        shareOfIncomePct: Number(((s.spentCents / incomeCents) * 100).toFixed(2)),
      },
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// 3. Concentracao de receita
// ---------------------------------------------------------------------------

export interface IncomeSource {
  label: string
  amountCents: number
}

/**
 * Sendeasy (6000) + Vansa (5000) = 61% da receita dele. A planilha soma isso
 * todo mes e nunca levanta a mao. Risco de concentracao e insight de verdade.
 */
export function detectIncomeConcentration(
  month: string,
  sources: IncomeSource[],
  thresholdPct = 50,
): Insight[] {
  const total = sources.reduce((s, x) => s + x.amountCents, 0)
  if (total <= 0 || sources.length < 2) return []

  const sorted = [...sources].sort((a, b) => b.amountCents - a.amountCents)
  const top2 = sorted.slice(0, 2)
  const top2Cents = top2.reduce((s, x) => s + x.amountCents, 0)
  const top2Pct = (top2Cents / total) * 100

  if (top2Pct < thresholdPct) return []

  return [
    {
      type: 'income_concentration',
      severity: top2Pct >= 70 ? 'critical' : 'warn',
      fingerprint: `income_concentration:${month}`,
      title: `${top2.map((s) => s.label).join(' e ')} são ${top2Pct.toFixed(0)}% da sua receita`,
      evidence: {
        month,
        totalCents: total,
        topSources: top2.map((s) => ({
          label: s.label,
          amountCents: s.amountCents,
          sharePct: Number(((s.amountCents / total) * 100).toFixed(2)),
        })),
        top2Pct: Number(top2Pct.toFixed(2)),
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// 4. Anomalia contra a media historica
// ---------------------------------------------------------------------------

export interface HistoricPoint {
  month: string
  amountCents: number
}

/**
 * Detecta gasto fora do padrao usando MAD (mediana dos desvios absolutos),
 * que e robusto a outlier. Media + desvio padrao seria contaminado pelo
 * proprio outlier que queremos achar.
 */
export function detectAnomaly(
  label: string,
  history: HistoricPoint[],
  current: HistoricPoint,
  madThreshold = 3.5,
): Insight[] {
  if (history.length < 4) return []

  const values = history.map((h) => h.amountCents).sort((a, b) => a - b)
  const median = medianOf(values)
  const deviations = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b)
  const mad = medianOf(deviations)

  // Distribuicao sem dispersao: qualquer mudanca e suspeita, mas so alerta
  // se for material.
  if (mad === 0) {
    if (current.amountCents === median) return []
    const delta = current.amountCents - median
    if (Math.abs(delta) < 1000) return []
    return [
      {
        type: 'anomaly',
        severity: 'warn',
        fingerprint: `anomaly:${label}:${current.month}`,
        title: `${label}: ${brl(current.amountCents)} quebra um histórico constante de ${brl(median)}`,
        evidence: { label, month: current.month, medianCents: median, currentCents: current.amountCents, deltaCents: delta },
      },
    ]
  }

  // 0.6745 normaliza o MAD para ser comparavel ao desvio padrao.
  const score = (0.6745 * (current.amountCents - median)) / mad
  if (Math.abs(score) < madThreshold) return []

  return [
    {
      type: 'anomaly',
      severity: Math.abs(score) >= 5 ? 'critical' : 'warn',
      fingerprint: `anomaly:${label}:${current.month}`,
      title: `${label}: ${brl(current.amountCents)} destoa da mediana de ${brl(median)}`,
      evidence: {
        label,
        month: current.month,
        medianCents: median,
        currentCents: current.amountCents,
        deltaCents: current.amountCents - median,
        modifiedZScore: Number(score.toFixed(2)),
        monthsAnalyzed: history.length,
      },
    },
  ]
}

function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

// ---------------------------------------------------------------------------
// 5. Assinatura orfa
// ---------------------------------------------------------------------------

export interface Subscription {
  ruleId: string
  label: string
  amountCents: number
  categoryName: string | null
  /** Meses desde o ultimo sinal de uso. null = nunca houve sinal. */
  monthsSinceSignal: number | null
}

/**
 * Assinatura que segue debitando. Sem telemetria de uso real, isto e uma
 * PERGUNTA ("ainda usa?"), nao uma afirmacao. O texto reflete isso.
 */
export function detectOrphanSubscriptions(
  subs: Subscription[],
  minMonths = 3,
): Insight[] {
  return subs
    .filter((s) => s.monthsSinceSignal !== null && s.monthsSinceSignal >= minMonths)
    .map((s) => ({
      type: 'orphan_subscription',
      severity: 'info' as Severity,
      fingerprint: `orphan_subscription:${s.ruleId}`,
      title: `${s.label} (${brl(s.amountCents)}/mês): ainda usa?`,
      evidence: {
        ruleId: s.ruleId,
        label: s.label,
        amountCents: s.amountCents,
        monthsSinceSignal: s.monthsSinceSignal,
        annualCents: s.amountCents * 12,
      },
    }))
}

// ---------------------------------------------------------------------------
// 6. Saldo projetado negativo
// ---------------------------------------------------------------------------

export interface CashflowDay {
  date: string
  balanceCents: number
}

/** Primeiro dia em que o saldo projetado fica negativo. */
export function detectNegativeCashflow(days: CashflowDay[]): Insight[] {
  const first = days.find((d) => d.balanceCents < 0)
  if (!first) return []

  const worst = days.reduce((min, d) => (d.balanceCents < min.balanceCents ? d : min), days[0]!)

  return [
    {
      type: 'negative_cashflow',
      severity: 'critical',
      fingerprint: `negative_cashflow:${first.date}`,
      title: `Saldo fica negativo em ${formatDate(first.date)} (${brl(first.balanceCents)})`,
      evidence: {
        firstNegativeDate: first.date,
        firstNegativeCents: first.balanceCents,
        worstDate: worst.date,
        worstCents: worst.balanceCents,
      },
    },
  ]
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ---------------------------------------------------------------------------
// 7. Categoria engolindo o orcamento (o problema do "OUTROS")
// ---------------------------------------------------------------------------

/**
 * "OUTROS" tem meta de 5% e carrega ~26% da receita dele: cartoes, DAS,
 * fraldas, Vercel. Isto nao e estouro de meta, e falta de taxonomia.
 */
export function detectCatchAllCategory(
  month: string,
  categoryName: string,
  categoryId: string,
  itemCount: number,
  spentCents: number,
  incomeCents: number,
  goalPct: number | null,
  minItems = 8,
): Insight[] {
  if (itemCount < minItems || incomeCents <= 0) return []
  const sharePct = (spentCents / incomeCents) * 100
  if (goalPct !== null && sharePct <= goalPct * 2) return []

  return [
    {
      type: 'catch_all_category',
      severity: 'warn',
      fingerprint: `catch_all_category:${categoryId}:${month}`,
      title: `"${categoryName}" concentra ${itemCount} lançamentos e ${sharePct.toFixed(0)}% da receita`,
      evidence: {
        month,
        categoryId,
        categoryName,
        itemCount,
        spentCents,
        sharePct: Number(sharePct.toFixed(2)),
        goalPct,
      },
    },
  ]
}
