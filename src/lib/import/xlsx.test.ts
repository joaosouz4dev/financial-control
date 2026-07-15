import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { parseWorkbook, parsePeriodFromFilename, parseInstallment } from './xlsx'

describe('parsePeriodFromFilename', () => {
  it.each([
    ['Controle Financeiro 07_2026.xlsx', { year: 2026, month: 7 }],
    ['Controle Financeiro 06_2026.xlsx', { year: 2026, month: 6 }],
    ['Controle Financeiro 12_2023.xlsx', { year: 2023, month: 12 }],
    ['controle-financeiro-01-2025.xlsx', { year: 2025, month: 1 }],
    ['2024_03 controle.xlsx', { year: 2024, month: 3 }],
  ])('%s', (name, expected) => {
    expect(parsePeriodFromFilename(name)).toEqual(expected)
  })

  it('devolve null quando nao ha periodo', () => {
    expect(parsePeriodFromFilename('planilha.xlsx')).toBeNull()
  })
})

describe('parseInstallment', () => {
  it.each([
    ['Parcela Carro 06/25', { current: 6, total: 25 }],
    ['Marmore 5/6', { current: 5, total: 6 }],
    ['Marmore 4/5', { current: 4, total: 5 }],
  ])('%s', (desc, expected) => {
    expect(parseInstallment(desc)).toEqual(expected)
  })

  it.each([
    ['Netflix'],
    ['Aluguel 12/2025'], // data, nao parcelamento
    ['Conta de Agua'],
  ])('nao confunde %s com parcelamento', (desc) => {
    expect(parseInstallment(desc)).toBeNull()
  })
})

// Roda so quando as planilhas reais estao presentes (gitignoradas).
const FIXTURE = 'planilhas/Controle Financeiro 07_2026.xlsx'
const hasFixtures = existsSync(FIXTURE)

describe.skipIf(!hasFixtures)('planilhas reais', () => {
  it('le 07/2026 sem warnings', async () => {
    const r = await parseWorkbook(FIXTURE, 'Controle Financeiro 07_2026.xlsx')
    expect(r.warnings).toEqual([])
    expect(r.period).toEqual({ year: 2026, month: 7 })
    expect(r.stats.expenses).toBe(34)
    expect(r.stats.incomes).toBe(9)
  })

  it('bate o total de receita com o SUM() do Excel', async () => {
    const r = await parseWorkbook(FIXTURE, 'Controle Financeiro 07_2026.xlsx')
    // M3 = SUM($G$2:$G1015) = 18298.60, cacheado pelo Excel
    expect(r.stats.totalIncomeCents).toBe(1829860)
  })

  /**
   * O SUM() do Excel ignora celulas de texto em silencio. A24 e a string
   * "R$ 354,20" (Escola Zaya), entao o TOTAL DESPESAS que a planilha exibe
   * (12.831,78) subestima a despesa real em exatamente 354,20.
   * O importador soma certo: 13.185,98.
   */
  it('conta a Escola Zaya que o SUM() da planilha ignora', async () => {
    const r = await parseWorkbook(FIXTURE, 'Controle Financeiro 07_2026.xlsx')
    const excelSumCents = 1283178
    const escolaZayaCents = 35420

    expect(r.stats.totalExpenseCents).toBe(1318598)
    expect(r.stats.totalExpenseCents - excelSumCents).toBe(escolaZayaCents)

    const escola = r.entries.find((e) => e.description === 'Escola Zaya')
    expect(escola).toMatchObject({ amountCents: 35420, kind: 'expense' })
  })

  it('preserva as formulas como intencao', async () => {
    const r = await parseWorkbook(FIXTURE, 'Controle Financeiro 07_2026.xlsx')
    const byDesc = (d: string) => r.entries.find((e) => e.description === d)

    expect(byDesc('Mercado')).toMatchObject({ amountExpression: '=4*550', amountCents: 220000 })
    expect(byDesc('Ração Cachorros 18kg')).toMatchObject({ amountExpression: '=2*75', amountCents: 15000 })
    expect(byDesc('Sendeasy Cursor')).toMatchObject({
      amountExpression: '=(60*5.1)+(60*5.1)*0.1',
      amountCents: 33660,
    })
  })

  it('detecta os parcelamentos', async () => {
    const r = await parseWorkbook(FIXTURE, 'Controle Financeiro 07_2026.xlsx')
    const inst = r.entries.filter((e) => e.installment)
    expect(inst.map((e) => [e.description, e.installment])).toEqual([
      ['Parcela Carro 06/25', { current: 6, total: 25 }],
      ['Marmore 5/6', { current: 5, total: 6 }],
      ['Marmore 4/5', { current: 4, total: 5 }],
    ])
  })

  it('le as metas do bloco OBJETIVO', async () => {
    const r = await parseWorkbook(FIXTURE, 'Controle Financeiro 07_2026.xlsx')
    const goals = Object.fromEntries(r.goals.map((g) => [g.categoryRaw, g.pct]))
    expect(goals).toMatchObject({
      CASA: 20,
      TRANSPORTE: 8,
      'SAÚDE': 10,
      'ALIMENTAÇÃO': 25,
      LAZER: 12,
      INVESTIMENTO: 20,
      OUTROS: 5,
    })
  })

  it('marca pago vs nao pago (coluna PAGAMENTO)', async () => {
    const r = await parseWorkbook(FIXTURE, 'Controle Financeiro 07_2026.xlsx')
    const agua = r.entries.find((e) => e.description === 'Conta de Agua')
    expect(agua).toMatchObject({ paidDay: 5, dueDay: 6 })

    const financiamento = r.entries.find((e) => e.description === 'Financiamento Casa')
    expect(financiamento).toMatchObject({ paidDay: null, dueDay: 20 })
  })
})

describe.skipIf(!existsSync('planilhas/Controle Financeiro 06_2026.xlsx'))('06/2026', () => {
  it('le sem warnings e bate a receita', async () => {
    const r = await parseWorkbook(
      'planilhas/Controle Financeiro 06_2026.xlsx',
      'Controle Financeiro 06_2026.xlsx',
    )
    expect(r.warnings).toEqual([])
    expect(r.stats.expenses).toBe(28)
    expect(r.stats.totalIncomeCents).toBe(1829860)
  })

  it('Netflix custava 44,90 em junho', async () => {
    const r = await parseWorkbook(
      'planilhas/Controle Financeiro 06_2026.xlsx',
      'Controle Financeiro 06_2026.xlsx',
    )
    expect(r.entries.find((e) => e.description === 'Netflix')?.amountCents).toBe(4490)
  })
})
