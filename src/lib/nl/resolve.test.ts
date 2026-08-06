import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { resolveDate, resolveAmountCents, resolveTransaction, ResolveError, TZ } from './resolve'
import type { ExtractedTransaction } from './schema'

dayjs.extend(utc)
dayjs.extend(timezone)

const NOW = dayjs.tz('2026-07-15', TZ)

const tx = (over: Partial<ExtractedTransaction> = {}): ExtractedTransaction => ({
  kind: 'expense',
  amount: { asWritten: '90', impliesMath: false, mathNote: null },
  labelHint: 'agua',
  dateRef: { type: 'today' },
  recurrence: 'monthly',
  intent: 'record',
  installment: null,
  confidence: 0.9,
  ambiguity: null,
  ...over,
})

describe('resolveDate: o servidor resolve, não a LLM', () => {
  it.each([
    [{ type: 'today' } as const, '2026-07-15'],
    [{ type: 'yesterday' } as const, '2026-07-14'],
    [{ type: 'relative_days', daysAgo: 3 } as const, '2026-07-12'],
    [{ type: 'last_week' } as const, '2026-07-08'],
    [{ type: 'this_month' } as const, '2026-07-01'],
    [{ type: 'last_month' } as const, '2026-06-01'],
    [{ type: 'explicit', iso: '2026-03-20' } as const, '2026-03-20'],
    [{ type: 'day_only', day: 5 } as const, '2026-07-05'],
    [{ type: 'unspecified' } as const, '2026-07-15'],
  ])('%o -> %s', (ref, expected) => {
    expect(resolveDate(ref, NOW)).toBe(expected)
  })

  it('clampa dia 31 em mês curto', () => {
    const emFevereiro = dayjs.tz('2026-02-10', TZ)
    expect(resolveDate({ type: 'day_only', day: 31 }, emFevereiro)).toBe('2026-02-28')
  })
})

describe('resolveAmountCents: a aritmética é do código', () => {
  it('converte o valor copiado literalmente', () => {
    expect(resolveAmountCents(tx({ amount: { asWritten: '90', impliesMath: false, mathNote: null } }))).toBe(9000)
    expect(resolveAmountCents(tx({ amount: { asWritten: '59,90', impliesMath: false, mathNote: null } }))).toBe(5990)
    expect(resolveAmountCents(tx({ amount: { asWritten: '1.850,00', impliesMath: false, mathNote: null } }))).toBe(185000)
  })

  it('aceita R$ no texto', () => {
    expect(resolveAmountCents(tx({ amount: { asWritten: 'R$ 354,20', impliesMath: false, mathNote: null } }))).toBe(35420)
  })

  /**
   * "mercado 550 por semana": a LLM copia "550" e marca impliesMath. Quem
   * multiplica por 4 e o codigo, com o multiplicador do codigo. Se a LLM
   * fizesse essa conta, o numero seria o que ela decidisse.
   */
  it('multiplica semanal por 4, do jeito que ele já escreve na planilha', () => {
    const semanal = tx({
      amount: { asWritten: '550', impliesMath: true, mathNote: 'semanal, multiplicar por 4' },
      recurrence: 'weekly',
      labelHint: 'mercado',
    })
    expect(resolveAmountCents(semanal)).toBe(220000) // = 4*550, igual à planilha
  })

  it('não multiplica quando não é semanal', () => {
    const mensal = tx({
      amount: { asWritten: '550', impliesMath: true, mathNote: 'x' },
      recurrence: 'monthly',
    })
    expect(resolveAmountCents(mensal)).toBe(55000)
  })

  it.each([
    ['', 'valor ausente'],
    ['abc', 'valor invalido'],
    ['0', 'positivo'],
    ['-50', 'positivo'],
  ])('rejeita %s', (raw, motivo) => {
    expect(() => resolveAmountCents(tx({ amount: { asWritten: raw, impliesMath: false, mathNote: null } })))
      .toThrow(ResolveError)
  })
})

describe('resolveTransaction', () => {
  it('preserva a intenção da fórmula no semanal', () => {
    const r = resolveTransaction(
      tx({
        amount: { asWritten: '550', impliesMath: true, mathNote: 'semanal' },
        recurrence: 'weekly',
        labelHint: 'Mercado',
      }),
      NOW,
    )
    expect(r.amountExpression).toBe('=4*550')
    expect(r.amountCents).toBe(220000)
  })

  it('normaliza o label', () => {
    expect(resolveTransaction(tx({ labelHint: '  NETFLIX  ' }), NOW).labelHint).toBe('netflix')
  })

  it('carrega a intenção adiante', () => {
    const r = resolveTransaction(tx({ intent: 'price_change' }), NOW)
    expect(r.intent).toBe('price_change')
  })

  it('preserva o parcelamento que a LLM leu', () => {
    const r = resolveTransaction(tx({ installment: { current: 5, total: 6 } }), NOW)
    expect(r.installment).toEqual({ current: 5, total: 6 })
  })
})
