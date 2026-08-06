import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import Decimal from 'decimal.js'
import { evaluateToCents, FormulaError } from '../formula/evaluate'
import type { DateRef, ExtractedTransaction } from './schema'

dayjs.extend(utc)
dayjs.extend(timezone)

export const TZ = 'America/Sao_Paulo'

/**
 * Aqui mora a aritmetica. A LLM entregou texto; o codigo valida e calcula.
 * Se algo aqui falhar, e erro deterministico com mensagem, nunca um numero
 * inventado.
 */

export class ResolveError extends Error {}

/** Resolve a referencia de tempo contra o agora do servidor, no fuso certo. */
export function resolveDate(ref: DateRef, now = dayjs().tz(TZ)): string {
  switch (ref.type) {
    case 'today':
    case 'unspecified':
      return now.format('YYYY-MM-DD')
    case 'yesterday':
      return now.subtract(1, 'day').format('YYYY-MM-DD')
    case 'relative_days':
      return now.subtract(ref.daysAgo, 'day').format('YYYY-MM-DD')
    case 'last_week':
      return now.subtract(1, 'week').format('YYYY-MM-DD')
    case 'this_month':
      return now.startOf('month').format('YYYY-MM-DD')
    case 'last_month':
      return now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
    case 'explicit':
      return ref.iso
    case 'day_only': {
      // "dia 15": o mes atual, clampando meses curtos.
      const last = now.daysInMonth()
      return now.date(Math.min(ref.day, last)).format('YYYY-MM-DD')
    }
  }
}

/**
 * Converte o valor copiado pela LLM em centavos.
 *
 * A LLM marcou impliesMath quando a conversao era necessaria, mas a conta e
 * feita aqui, com Decimal: "550 por semana" vira 550 * 4 e nao o que o modelo
 * achar. O multiplicador e do codigo, nao do texto.
 */
export function resolveAmountCents(tx: ExtractedTransaction): number {
  const raw = tx.amount.asWritten.trim()
  if (!raw) throw new ResolveError('valor ausente')

  let cents: number
  try {
    cents = evaluateToCents(raw.replace(/R\$\s*/gi, ''))
  } catch (e) {
    if (e instanceof FormulaError) throw new ResolveError(`valor invalido: "${raw}"`)
    throw e
  }

  if (cents <= 0) throw new ResolveError(`valor precisa ser positivo: "${raw}"`)

  // Semanal para mensal: 4 semanas, que e como o Joao ja escreve na planilha
  // (Mercado = 4*550). Nao 4.33: o modelo mental dele e 4 compras por mes.
  if (tx.amount.impliesMath && tx.recurrence === 'weekly') {
    return new Decimal(cents).times(4).toDecimalPlaces(0).toNumber()
  }

  return cents
}

export interface ResolvedTransaction {
  kind: 'income' | 'expense'
  intent: ExtractedTransaction['intent']
  amountCents: number
  amountExpression: string | null
  labelHint: string
  date: string
  recurrence: ExtractedTransaction['recurrence']
  installment: { current: number; total: number } | null
  confidence: number
  ambiguity: string | null
}

export function resolveTransaction(
  tx: ExtractedTransaction,
  now = dayjs().tz(TZ),
): ResolvedTransaction {
  const amountCents = resolveAmountCents(tx)

  // Preserva a intencao: "550 por semana" guarda a expressao, nao so o total.
  const expression =
    tx.amount.impliesMath && tx.recurrence === 'weekly'
      ? `=4*${tx.amount.asWritten.replace(',', '.')}`
      : null

  return {
    kind: tx.kind,
    intent: tx.intent,
    amountCents,
    amountExpression: expression,
    labelHint: tx.labelHint.trim().toLowerCase(),
    date: resolveDate(tx.dateRef, now),
    recurrence: tx.recurrence,
    installment: tx.installment,
    confidence: tx.confidence,
    ambiguity: tx.ambiguity,
  }
}
