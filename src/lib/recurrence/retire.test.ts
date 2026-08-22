import { describe, it, expect } from 'vitest'
import { selectStaleRules, monthsBefore } from './retire'

const rule = (over: Partial<Parameters<typeof selectStaleRules>[0][number]> & { id: string }) => ({
  startsOn: '2022-01-01',
  lastSeen: null,
  ...over,
})

describe('selectStaleRules', () => {
  it('encerra regra que parou de acontecer, na data do ultimo lancamento', () => {
    const out = selectStaleRules([rule({ id: 'a', lastSeen: '2022-06-01' })], '2026-08-22')
    expect(out).toEqual([{ id: 'a', endsOn: '2022-06-01' }])
  })

  it('mantem regra que ainda acontece', () => {
    const out = selectStaleRules([rule({ id: 'a', lastSeen: '2026-07-10' })], '2026-08-22')
    expect(out).toEqual([])
  })

  /** Anual fica 11 meses parado sem estar morto: o corte de 12 meses o protege. */
  it('não mata lançamento anual', () => {
    const out = selectStaleRules([rule({ id: 'iptu', lastSeen: '2025-10-01' })], '2026-08-22')
    expect(out).toEqual([])
  })

  it('regra sem lançamento nenhum encerra no próprio início', () => {
    const out = selectStaleRules([rule({ id: 'a', startsOn: '2022-06-01' })], '2026-08-22')
    expect(out).toEqual([{ id: 'a', endsOn: '2022-06-01' }])
  })

  it('é exatamente o limite, não aproximado', () => {
    // 12 meses antes de 2026-08-22 é 2025-08-22.
    expect(selectStaleRules([rule({ id: 'a', lastSeen: '2025-08-22' })], '2026-08-22')).toEqual([])
    expect(selectStaleRules([rule({ id: 'a', lastSeen: '2025-08-21' })], '2026-08-22')).toEqual([
      { id: 'a', endsOn: '2025-08-21' },
    ])
  })

  it('respeita um corte customizado', () => {
    const out = selectStaleRules([rule({ id: 'a', lastSeen: '2026-01-10' })], '2026-08-22', 6)
    expect(out).toEqual([{ id: 'a', endsOn: '2026-01-10' }])
  })
})

describe('monthsBefore', () => {
  it('volta meses dentro do mesmo ano', () => {
    expect(monthsBefore('2026-08-22', 3)).toBe('2026-05-22')
  })

  it('atravessa a virada do ano', () => {
    expect(monthsBefore('2026-02-10', 12)).toBe('2025-02-10')
    expect(monthsBefore('2026-01-15', 1)).toBe('2025-12-15')
  })

  it('clampa dia em mês curto', () => {
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28')
  })
})
