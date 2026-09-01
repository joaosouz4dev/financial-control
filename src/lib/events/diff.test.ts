import { describe, expect, it } from 'vitest'
import { describeEvent, diffTransaction, formatCents, formatDate, type TxSnapshot } from './diff'

const base: TxSnapshot = {
  description: 'Internet',
  amountCents: 9200,
  dueDate: '2026-09-05',
  categoryName: 'Casa',
  paidAt: null,
}

const em = (p: Partial<TxSnapshot>): TxSnapshot => ({ ...base, ...p })

describe('diffTransaction', () => {
  it('salvar sem mudar nada nao sujeita o historico', () => {
    expect(diffTransaction(base, em({}))).toEqual([])
  })

  it('registra o pagamento e o estorno como eventos distintos', () => {
    const pago = diffTransaction(base, em({ paidAt: new Date('2026-09-05') }))
    expect(pago).toHaveLength(1)
    expect(pago[0]!.kind).toBe('paid')

    const voltou = diffTransaction(em({ paidAt: new Date('2026-09-05') }), base)
    expect(voltou[0]!.kind).toBe('unpaid')
  })

  it('mudar a data do pagamento nao conta como novo pagamento', () => {
    // Continua pago: o que mudou foi so o dia, e isso nao e troca de estado.
    const r = diffTransaction(
      em({ paidAt: new Date('2026-09-05') }),
      em({ paidAt: new Date('2026-09-07') }),
    )
    expect(r).toEqual([])
  })

  it('guarda o valor antigo e o novo, ja formatados', () => {
    const r = diffTransaction(base, em({ amountCents: 11000 }))
    expect(r).toHaveLength(1)
    expect(r[0]!.fromValue).toBe(formatCents(9200))
    expect(r[0]!.toValue).toBe(formatCents(11000))
  })

  it('acumula varias mudancas de uma edicao so', () => {
    const r = diffTransaction(
      base,
      em({ description: 'Internet Fibra', amountCents: 12000, dueDate: '2026-09-10' }),
    )
    expect(r.map((e) => e.kind).sort()).toEqual(['amount', 'description', 'due_date'])
  })

  it('trata ausencia de categoria como um valor, nao como buraco', () => {
    const r = diffTransaction(base, em({ categoryName: null }))
    expect(r[0]!.toValue).toBe('sem categoria')

    const volta = diffTransaction(em({ categoryName: null }), base)
    expect(volta[0]!.fromValue).toBe('sem categoria')
  })
})

describe('formatacao', () => {
  it('mostra o valor como a tabela mostra', () => {
    // NBSP depois do R$: e o que o toLocaleString pt-BR emite.
    expect(formatCents(9200)).toBe('R$\u00a092,00')
    expect(formatCents(150000)).toBe('R$\u00a01.500,00')
  })

  it('escreve a data como no Brasil', () => {
    expect(formatDate('2026-09-05')).toBe('05/09/2026')
  })
})

describe('describeEvent', () => {
  it('escreve cada tipo em portugues', () => {
    expect(describeEvent({ kind: 'created', fromValue: null, toValue: null })).toBe(
      'Lançamento criado',
    )
    expect(describeEvent({ kind: 'paid', fromValue: 'a pagar', toValue: 'pago' })).toBe(
      'Marcado como pago',
    )
    expect(
      describeEvent({ kind: 'amount', fromValue: 'R$\u00a092,00', toValue: 'R$\u00a0110,00' }),
    ).toContain('92,00')
  })

  it('nao quebra num tipo que ainda nao conhece', () => {
    expect(describeEvent({ kind: 'algo_novo', fromValue: null, toValue: null })).toBe('Alteração')
  })
})
