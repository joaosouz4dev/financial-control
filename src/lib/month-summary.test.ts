import { describe, it, expect } from 'vitest'
import { summarizeMonth, formatBRL, type Tx, type Goal } from './month-summary'

const tx = (over: Partial<Tx>): Tx => ({
  id: Math.random().toString(36).slice(2),
  kind: 'expense',
  amountCents: 10000,
  description: 'X',
  categorySlug: 'casa',
  categoryName: 'Casa',
  dueDate: '2026-07-10',
  paidAt: null,
  contextSlug: 'pessoal',
  ...over,
})

const goals: Goal[] = [
  { categorySlug: 'casa', categoryName: 'Casa', pct: 20 },
  { categorySlug: 'alimentacao', categoryName: 'Alimentação', pct: 25 },
]

describe('summarizeMonth: paridade com o RESUMO GERAL da planilha', () => {
  const txs = [
    tx({ amountCents: 8959, description: 'Conta de Agua', paidAt: '2026-07-05' }),
    tx({ amountCents: 185000, description: 'Financiamento Casa', paidAt: null }),
    tx({ amountCents: 220000, description: 'Mercado', categorySlug: 'alimentacao', categoryName: 'Alimentação' }),
    tx({ kind: 'income', amountCents: 600000, description: 'Sendeasy', categorySlug: null, categoryName: null, paidAt: '2026-07-10' }),
    tx({ kind: 'income', amountCents: 500000, description: 'Vansa', categorySlug: null, categoryName: null, paidAt: null }),
  ]

  const s = summarizeMonth('2026-07', txs, goals)

  it('TOTAL DESPESAS', () => {
    expect(s.totalExpenseCents).toBe(8959 + 185000 + 220000)
  })

  it('TOTAL RECEITA', () => {
    expect(s.totalIncomeCents).toBe(1100000)
  })

  it('TOTAL PAGO (coluna PAGAMENTO preenchida)', () => {
    expect(s.paidCents).toBe(8959)
  })

  it('A PAGAR', () => {
    expect(s.toPayCents).toBe(185000 + 220000)
  })

  it('Saldo a Receber', () => {
    expect(s.toReceiveCents).toBe(500000)
  })

  it('Saldo Atual (recebido menos pago)', () => {
    expect(s.currentBalanceCents).toBe(600000 - 8959)
  })

  it('Previsao Saldo Final (receita menos despesa)', () => {
    expect(s.projectedBalanceCents).toBe(1100000 - 413959)
  })

  it('INVESTIMENTO (20% da receita)', () => {
    expect(s.investmentTargetCents).toBe(220000)
  })
})

describe('a regra que impede dupla contagem', () => {
  it('transferencia nao entra em despesa nem em categoria', () => {
    const txs = [
      // A compra no cartao: ESTA e a despesa.
      tx({ amountCents: 55000, description: 'Mercado no cartao', categorySlug: 'alimentacao', categoryName: 'Alimentação' }),
      // Pagar a fatura: transferencia, nao despesa nova.
      tx({ kind: 'transfer', amountCents: 55000, description: 'Pagamento fatura Caixa', categorySlug: null, categoryName: null }),
    ]

    const s = summarizeMonth('2026-07', txs, goals)

    expect(s.totalExpenseCents).toBe(55000) // nao 110000
    expect(s.expenseCount).toBe(1)
    const alim = s.categories.find((c) => c.slug === 'alimentacao')
    expect(alim?.spentCents).toBe(55000)
  })

  it('transferencia tambem nao conta como pago', () => {
    const txs = [
      tx({ kind: 'transfer', amountCents: 99900, description: 'Pagamento fatura', paidAt: '2026-07-14' }),
    ]
    const s = summarizeMonth('2026-07', txs, goals)
    expect(s.paidCents).toBe(0)
    expect(s.totalExpenseCents).toBe(0)
  })
})

describe('categorias e metas', () => {
  it('calcula meta em reais sobre a receita e o uso', () => {
    const txs = [
      tx({ kind: 'income', amountCents: 1000000, categorySlug: null, categoryName: null }),
      tx({ amountCents: 300000, categorySlug: 'casa', categoryName: 'Casa' }),
    ]
    const s = summarizeMonth('2026-07', txs, goals)
    const casa = s.categories.find((c) => c.slug === 'casa')!

    expect(casa.goalCents).toBe(200000) // 20% de 10.000
    expect(casa.spentCents).toBe(300000)
    expect(casa.usagePct).toBe(150) // estourou em 50%
  })

  it('mostra categoria com meta mesmo sem gasto', () => {
    const txs = [tx({ kind: 'income', amountCents: 1000000, categorySlug: null, categoryName: null })]
    const s = summarizeMonth('2026-07', txs, goals)
    const alim = s.categories.find((c) => c.slug === 'alimentacao')
    expect(alim).toMatchObject({ spentCents: 0, goalCents: 250000, count: 0 })
  })

  it('agrupa gasto sem categoria', () => {
    const txs = [tx({ amountCents: 5000, categorySlug: null, categoryName: null })]
    const s = summarizeMonth('2026-07', txs, goals)
    expect(s.categories.find((c) => c.slug === 'sem-categoria')?.spentCents).toBe(5000)
  })

  it('ordena por gasto decrescente', () => {
    const txs = [
      tx({ amountCents: 1000, categorySlug: 'casa', categoryName: 'Casa' }),
      tx({ amountCents: 9000, categorySlug: 'alimentacao', categoryName: 'Alimentação' }),
    ]
    const s = summarizeMonth('2026-07', txs, goals)
    expect(s.categories[0]!.slug).toBe('alimentacao')
  })

  it('nao divide por zero quando nao ha receita', () => {
    const s = summarizeMonth('2026-07', [tx({ amountCents: 5000 })], goals)
    expect(s.categories.find((c) => c.slug === 'casa')?.usagePct).toBeNull()
  })
})

describe('formatBRL', () => {
  it('formata em pt-BR', () => {
    // toLocaleString usa espaco nao-quebravel (U+00A0) apos o R$.
    expect(formatBRL(1829860)).toBe('R$ 18.298,60')
    expect(formatBRL(-50000)).toBe('-R$ 500,00')
    expect(formatBRL(0)).toBe('R$ 0,00')
  })
})
