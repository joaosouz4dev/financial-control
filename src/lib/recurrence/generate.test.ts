import { describe, it, expect } from 'vitest'
import { generateOccurrences, resolveDayOfMonth, type Rule } from './generate'

const base: Rule = {
  id: 'r1',
  cadence: 'monthly',
  dayOfMonth: 30,
  startsOn: '2026-01-01',
  endsOn: null,
  active: true,
  amountCents: 5990,
  installmentCurrent: null,
  installmentTotal: null,
  installmentAnchor: null,
}

describe('resolveDayOfMonth', () => {
  it('clampa dia 30 em fevereiro (nao vaza para marco)', () => {
    expect(resolveDayOfMonth(2026, 2, 30)).toBe('2026-02-28')
  })

  it('respeita ano bissexto', () => {
    expect(resolveDayOfMonth(2028, 2, 30)).toBe('2028-02-29')
  })

  it('clampa dia 31 em meses de 30 dias', () => {
    expect(resolveDayOfMonth(2026, 4, 31)).toBe('2026-04-30')
  })

  it('mantem o dia quando cabe', () => {
    expect(resolveDayOfMonth(2026, 7, 15)).toBe('2026-07-15')
  })
})

describe('Netflix: mensal dia 30', () => {
  it('gera um por mes, com fevereiro clampado', () => {
    const occ = generateOccurrences(base, '2026-01-01', '2026-04-30')
    expect(occ.map((o) => o.dueDate)).toEqual([
      '2026-01-30',
      '2026-02-28',
      '2026-03-30',
      '2026-04-30',
    ])
  })

  it('nao gera nada quando inativa', () => {
    expect(generateOccurrences({ ...base, active: false }, '2026-01-01', '2026-12-31')).toEqual([])
  })
})

describe('Parcela Carro 06/25: a regra sabe onde morre', () => {
  const carro: Rule = {
    ...base,
    id: 'carro',
    dayOfMonth: 12,
    amountCents: 150000,
    installmentCurrent: 6,
    installmentTotal: 25,
    installmentAnchor: '2026-07-12',
    startsOn: '2026-07-01',
  }

  it('numera as parcelas a partir da ancora', () => {
    const occ = generateOccurrences(carro, '2026-07-01', '2026-10-31')
    expect(occ.map((o) => [o.dueDate, o.installmentNo])).toEqual([
      ['2026-07-12', 6],
      ['2026-08-12', 7],
      ['2026-09-12', 8],
      ['2026-10-12', 9],
    ])
  })

  it('para sozinha na parcela 25, sem endsOn', () => {
    const occ = generateOccurrences(carro, '2026-07-01', '2030-12-31')
    expect(occ).toHaveLength(20) // parcelas 6..25
    expect(occ.at(-1)).toMatchObject({ dueDate: '2028-02-12', installmentNo: 25 })
  })
})

describe('Marmore 5/6: parcelamento curto', () => {
  const marmore: Rule = {
    ...base,
    id: 'marmore',
    dayOfMonth: 2,
    amountCents: 36900,
    installmentCurrent: 5,
    installmentTotal: 6,
    installmentAnchor: '2026-07-02',
    startsOn: '2026-07-01',
  }

  it('gera so as duas parcelas restantes', () => {
    const occ = generateOccurrences(marmore, '2026-07-01', '2027-12-31')
    expect(occ.map((o) => [o.dueDate, o.installmentNo])).toEqual([
      ['2026-07-02', 5],
      ['2026-08-02', 6],
    ])
  })
})

describe('janela e limites', () => {
  it('respeita endsOn', () => {
    const occ = generateOccurrences(
      { ...base, dayOfMonth: 15, endsOn: '2026-03-31' },
      '2026-01-01',
      '2026-12-31',
    )
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })

  it('nao gera antes de startsOn', () => {
    const occ = generateOccurrences(
      { ...base, dayOfMonth: 10, startsOn: '2026-06-01' },
      '2026-01-01',
      '2026-08-31',
    )
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-06-10', '2026-07-10', '2026-08-10'])
  })

  it('one_off gera exatamente uma vez', () => {
    const occ = generateOccurrences(
      { ...base, cadence: 'one_off', startsOn: '2026-07-20' },
      '2026-01-01',
      '2026-12-31',
    )
    expect(occ).toEqual([
      { ruleId: 'r1', dueDate: '2026-07-20', expectedCents: 5990, installmentNo: null },
    ])
  })

  it('semanal: Mercado toda semana', () => {
    const occ = generateOccurrences(
      { ...base, cadence: 'weekly', dayOfMonth: null, startsOn: '2026-07-01' },
      '2026-07-01',
      '2026-07-31',
    )
    expect(occ.length).toBeGreaterThanOrEqual(4)
    expect(occ.every((o) => o.dueDate >= '2026-07-01' && o.dueDate <= '2026-07-31')).toBe(true)
  })
})
