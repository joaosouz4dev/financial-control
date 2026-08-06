import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

export const TZ = 'America/Sao_Paulo'

export type Cadence = 'monthly' | 'weekly' | 'biweekly' | 'yearly' | 'one_off'

export interface Rule {
  id: string
  cadence: Cadence
  dayOfMonth: number | null
  startsOn: string // YYYY-MM-DD
  endsOn: string | null
  active: boolean
  amountCents: number
  installmentCurrent: number | null
  installmentTotal: number | null
  installmentAnchor: string | null
}

export interface Occurrence {
  ruleId: string
  dueDate: string
  expectedCents: number
  installmentNo: number | null
}

/**
 * Resolve o dia do mes respeitando meses curtos.
 *
 * A planilha usa 30 para "todo fim de mes" (Netflix, Mercado, celulares).
 * Em fevereiro isso precisa virar 28 ou 29, nao estourar para 2 de marco.
 * Idem dia 31. Por isso o clamp para o ultimo dia do mes.
 */
export function resolveDayOfMonth(year: number, month: number, day: number): string {
  const base = dayjs.tz(`${year}-${String(month).padStart(2, '0')}-01`, TZ)
  const lastDay = base.daysInMonth()
  return base.date(Math.min(day, lastDay)).format('YYYY-MM-DD')
}

/**
 * Gera as ocorrencias de uma regra dentro de uma janela.
 *
 * Idempotente por construcao: o unique (ruleId, dueDate) no banco absorve
 * reexecucao, entao isto pode rodar em cron sem medo.
 *
 * Parcelamento: a regra sabe onde termina. "Parcela Carro 06/25" com ancora
 * em 2026-07-12 significa que a parcela 25 cai em 2027-02-12 e a geracao para
 * ali sozinha. E isto que substitui renomear 05/25 -> 06/25 na mao.
 */
export function generateOccurrences(rule: Rule, fromISO: string, toISO: string): Occurrence[] {
  if (!rule.active) return []

  const out: Occurrence[] = []
  const from = dayjs.tz(fromISO, TZ)
  const to = dayjs.tz(toISO, TZ)
  const starts = dayjs.tz(rule.startsOn, TZ)
  const ends = rule.endsOn ? dayjs.tz(rule.endsOn, TZ) : null

  const windowStart = starts.isAfter(from) ? starts : from
  let hardEnd = ends && ends.isBefore(to) ? ends : to

  // Parcelamento define o fim real, mesmo sem endsOn preenchido.
  if (rule.installmentTotal && rule.installmentCurrent && rule.installmentAnchor) {
    const remaining = rule.installmentTotal - rule.installmentCurrent
    const anchor = dayjs.tz(rule.installmentAnchor, TZ)
    const lastInstallment = addCadence(anchor, rule.cadence, remaining)
    if (lastInstallment.isBefore(hardEnd)) hardEnd = lastInstallment
  }

  if (rule.cadence === 'one_off') {
    const d = starts.format('YYYY-MM-DD')
    if (!starts.isBefore(from) && !starts.isAfter(to)) {
      out.push({ ruleId: rule.id, dueDate: d, expectedCents: rule.amountCents, installmentNo: null })
    }
    return out
  }

  let cursor = windowStart.startOf('month')
  let guard = 0

  while (guard++ < 600) {
    let due: dayjs.Dayjs

    if (rule.cadence === 'monthly' || rule.cadence === 'yearly') {
      const day = rule.dayOfMonth ?? starts.date()
      due = dayjs.tz(resolveDayOfMonth(cursor.year(), cursor.month() + 1, day), TZ)
    } else {
      due = cursor
    }

    if (due.isAfter(hardEnd)) break

    if (!due.isBefore(windowStart) && !due.isBefore(starts)) {
      out.push({
        ruleId: rule.id,
        dueDate: due.format('YYYY-MM-DD'),
        expectedCents: rule.amountCents,
        installmentNo: installmentNoFor(rule, due),
      })
    }

    cursor = advance(cursor, rule.cadence)
    if (cursor.isAfter(hardEnd) && rule.cadence !== 'monthly' && rule.cadence !== 'yearly') break
  }

  return out
}

function advance(d: dayjs.Dayjs, cadence: Cadence): dayjs.Dayjs {
  switch (cadence) {
    case 'monthly':
      return d.add(1, 'month')
    case 'yearly':
      return d.add(1, 'year')
    case 'weekly':
      return d.add(1, 'week')
    case 'biweekly':
      return d.add(2, 'week')
    default:
      return d.add(1, 'month')
  }
}

function addCadence(d: dayjs.Dayjs, cadence: Cadence, times: number): dayjs.Dayjs {
  switch (cadence) {
    case 'monthly':
      return d.add(times, 'month')
    case 'yearly':
      return d.add(times, 'year')
    case 'weekly':
      return d.add(times, 'week')
    case 'biweekly':
      return d.add(times * 2, 'week')
    default:
      return d
  }
}

/** Qual numero de parcela cai nesta data, dada a ancora. */
function installmentNoFor(rule: Rule, due: dayjs.Dayjs): number | null {
  if (!rule.installmentCurrent || !rule.installmentAnchor) return null
  const anchor = dayjs.tz(rule.installmentAnchor, TZ)

  let diff: number
  switch (rule.cadence) {
    case 'monthly':
      diff = due.diff(anchor, 'month')
      break
    case 'yearly':
      diff = due.diff(anchor, 'year')
      break
    case 'weekly':
      diff = due.diff(anchor, 'week')
      break
    case 'biweekly':
      diff = Math.floor(due.diff(anchor, 'week') / 2)
      break
    default:
      return rule.installmentCurrent
  }

  const n = rule.installmentCurrent + diff
  if (rule.installmentTotal && n > rule.installmentTotal) return null
  return n
}

/** Horizonte rolante padrao: 13 meses a frente do inicio do mes atual. */
export function rollingHorizon(now = dayjs().tz(TZ)) {
  return {
    from: now.startOf('month').format('YYYY-MM-DD'),
    to: now.startOf('month').add(13, 'month').endOf('month').format('YYYY-MM-DD'),
  }
}
