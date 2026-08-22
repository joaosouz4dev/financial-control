/**
 * Projecao de fluxo de caixa.
 *
 * A planilha calcula "Previsao Saldo Final" para o mes inteiro, o que esconde
 * o problema real: o saldo pode ficar negativo no dia 12 e voltar no dia 29.
 * O total do mes fecha positivo e mesmo assim o cheque volta.
 *
 * Deterministico e puro: entra o previsto, sai a curva. Sem LLM.
 */

export type Direction = 'in' | 'out'

export interface FlowItem {
  date: string
  label: string
  amountCents: number
  direction: Direction
  /** Ja aconteceu (pago/recebido) ou ainda e previsao. */
  settled: boolean
  ruleId: string | null
  /**
   * Previsao cuja regra nao tem dia de vencimento: a data e um palpite (o dia
   * do starts_on), nao um compromisso real. A planilha nao trazia o dia nessas
   * linhas. Some no dia 1 e nao no dia certo, entao a curva mostra um degrau
   * que na vida real esta espalhado pelo mes.
   */
  dateInferred?: boolean
}

export interface DayPoint {
  date: string
  /** Movimento liquido do dia. */
  deltaCents: number
  /** Saldo acumulado ao fim do dia. */
  balanceCents: number
  items: FlowItem[]
}

export interface Projection {
  days: DayPoint[]
  openingBalanceCents: number
  closingBalanceCents: number
  /** Primeiro dia em que o saldo fica negativo, se houver. */
  firstNegative: DayPoint | null
  /** Pior saldo do periodo. */
  trough: DayPoint | null
  totalInCents: number
  totalOutCents: number
}

/**
 * Constroi a curva de saldo dia a dia.
 *
 * Ordena por data e acumula. Dentro do mesmo dia, entrada antes de saida:
 * e o comportamento otimista, mas e o realista para salario/vencimento no
 * mesmo dia, e evita alarme falso de negativo que se resolve em horas.
 *
 * A serie cobre TODOS os dias de [from, to], inclusive os sem movimento. Antes
 * so os dias com lancamento entravam, e o grafico plotava por indice: o mes
 * virava uma regua elastica onde a distancia entre dois pontos nao dizia
 * quantos dias passaram, e a curva era esticada ate as bordas mesmo quando o
 * primeiro movimento caia no dia 12. Dia parado e informacao: o saldo fica
 * onde estava.
 */
export function projectCashflow(
  items: FlowItem[],
  openingBalanceCents: number,
  from: string,
  to: string,
): Projection {
  const inWindow = items.filter((i) => i.date >= from && i.date <= to)

  const byDate = new Map<string, FlowItem[]>()
  for (const i of inWindow) {
    const arr = byDate.get(i.date) ?? []
    arr.push(i)
    byDate.set(i.date, arr)
  }

  const days: DayPoint[] = []
  let balance = openingBalanceCents
  let totalIn = 0
  let totalOut = 0

  for (const date of eachDay(from, to)) {
    const dayItems = byDate.get(date) ?? []
    // Entrada antes de saida no mesmo dia.
    dayItems.sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1))

    let delta = 0
    for (const i of dayItems) {
      if (i.direction === 'in') {
        delta += i.amountCents
        totalIn += i.amountCents
      } else {
        delta -= i.amountCents
        totalOut += i.amountCents
      }
    }

    balance += delta
    days.push({ date, deltaCents: delta, balanceCents: balance, items: dayItems })
  }

  const firstNegative = days.find((d) => d.balanceCents < 0) ?? null
  const trough =
    days.length > 0
      ? days.reduce((min, d) => (d.balanceCents < min.balanceCents ? d : min), days[0]!)
      : null

  return {
    days,
    openingBalanceCents,
    closingBalanceCents: balance,
    firstNegative,
    trough,
    totalInCents: totalIn,
    totalOutCents: totalOut,
  }
}

export interface MonthProjection {
  month: string
  openingCents: number
  closingCents: number
  inCents: number
  outCents: number
  netCents: number
}

/** Agrega a curva por mes: a visao de 6 a 12 meses a frente. */
export function projectByMonth(
  items: FlowItem[],
  openingBalanceCents: number,
  from: string,
  to: string,
): MonthProjection[] {
  const inWindow = items.filter((i) => i.date >= from && i.date <= to)

  const byMonth = new Map<string, FlowItem[]>()
  for (const i of inWindow) {
    const m = i.date.slice(0, 7)
    const arr = byMonth.get(m) ?? []
    arr.push(i)
    byMonth.set(m, arr)
  }

  const months = [...byMonth.keys()].sort()
  const out: MonthProjection[] = []
  let balance = openingBalanceCents

  for (const month of months) {
    const opening = balance
    let inCents = 0
    let outCents = 0

    for (const i of byMonth.get(month)!) {
      if (i.direction === 'in') inCents += i.amountCents
      else outCents += i.amountCents
    }

    balance = opening + inCents - outCents
    out.push({
      month,
      openingCents: opening,
      closingCents: balance,
      inCents,
      outCents,
      netCents: inCents - outCents,
    })
  }

  return out
}

/**
 * Compromissos que ainda nao venceram: o que a planilha chama de "A PAGAR",
 * mas ordenado por urgencia real em vez de por linha da planilha.
 */
export function upcomingCommitments(items: FlowItem[], today: string, days = 14): FlowItem[] {
  const limit = addDays(today, days)
  return items
    .filter((i) => !i.settled && i.direction === 'out' && i.date >= today && i.date <= limit)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents)
}

/** Todos os dias do intervalo, inclusive os extremos. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  // Guarda contra intervalo invertido ou datas malformadas: sem isto um
  // `to` menor que `from` giraria para sempre.
  for (let i = 0; cur <= to && i < 400; i++) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}
