import { describe, it, expect } from 'vitest'
import { projectCashflow, projectByMonth, upcomingCommitments, type FlowItem } from './project'

const item = (over: Partial<FlowItem> & { date: string; amountCents: number }): FlowItem => ({
  label: 'X',
  direction: 'out',
  settled: false,
  ruleId: null,
  ...over,
})

describe('projectCashflow', () => {
  it('acumula o saldo dia a dia', () => {
    const p = projectCashflow(
      [
        item({ date: '2026-07-05', amountCents: 400000, direction: 'in', label: 'MatchMaking Bot' }),
        item({ date: '2026-07-12', amountCents: 150000, label: 'Parcela Carro' }),
        item({ date: '2026-07-20', amountCents: 185000, label: 'Financiamento Casa' }),
      ],
      0,
      '2026-07-01',
      '2026-07-31',
    )

    // A serie cobre o mes inteiro; dia sem movimento carrega o saldo anterior.
    expect(p.days).toHaveLength(31)
    expect(p.days[0]!.date).toBe('2026-07-01')
    expect(p.days.at(-1)!.date).toBe('2026-07-31')

    const saldoEm = (date: string) => p.days.find((d) => d.date === date)!.balanceCents
    expect(saldoEm('2026-07-04')).toBe(0)
    expect(saldoEm('2026-07-05')).toBe(400000)
    expect(saldoEm('2026-07-11')).toBe(400000)
    expect(saldoEm('2026-07-12')).toBe(250000)
    expect(saldoEm('2026-07-20')).toBe(65000)
    expect(saldoEm('2026-07-31')).toBe(65000)
    expect(p.closingBalanceCents).toBe(65000)
    expect(p.totalInCents).toBe(400000)
    expect(p.totalOutCents).toBe(335000)
  })

  /**
   * O caso que a planilha esconde: o mes fecha POSITIVO, mas o saldo mergulha
   * no dia 12. "Previsao Saldo Final" e um numero so, e nao mostra isso.
   */
  it('acha o negativo no meio do mês mesmo com o mês fechando positivo', () => {
    const p = projectCashflow(
      [
        item({ date: '2026-07-12', amountCents: 150000, label: 'Parcela Carro' }),
        item({ date: '2026-07-14', amountCents: 180860, label: 'Cartão Caixa' }),
        item({ date: '2026-07-20', amountCents: 185000, label: 'Financiamento' }),
        item({ date: '2026-07-29', amountCents: 500000, direction: 'in', label: 'Vansa' }),
      ],
      100000, // R$ 1.000 de saldo inicial
      '2026-07-01',
      '2026-07-31',
    )

    // Fecha positivo...
    expect(p.closingBalanceCents).toBe(84140)
    // ...e mesmo assim ficou negativo no dia 12.
    expect(p.firstNegative?.date).toBe('2026-07-12')
    expect(p.firstNegative?.balanceCents).toBe(-50000)
    expect(p.trough?.date).toBe('2026-07-20')
    expect(p.trough?.balanceCents).toBe(-415860)
  })

  it('silencia quando o saldo nunca fica negativo', () => {
    const p = projectCashflow(
      [item({ date: '2026-07-10', amountCents: 5000 })],
      100000,
      '2026-07-01',
      '2026-07-31',
    )
    expect(p.firstNegative).toBeNull()
  })

  it('entrada vem antes de saída no mesmo dia', () => {
    // Salário e vencimento no mesmo dia não deve acusar negativo falso.
    const p = projectCashflow(
      [
        item({ date: '2026-07-10', amountCents: 600000, label: 'Cartão' }),
        item({ date: '2026-07-10', amountCents: 600000, direction: 'in', label: 'Sendeasy' }),
      ],
      0,
      '2026-07-01',
      '2026-07-31',
    )
    expect(p.firstNegative).toBeNull()
    const dia10 = p.days.find((d) => d.date === '2026-07-10')!
    expect(dia10.balanceCents).toBe(0)
    // A ordem dentro do dia: entrada primeiro.
    expect(dia10.items[0]!.direction).toBe('in')
  })

  it('ignora o que está fora da janela', () => {
    const p = projectCashflow(
      [
        item({ date: '2026-06-30', amountCents: 999999 }),
        item({ date: '2026-07-10', amountCents: 5000 }),
        item({ date: '2026-08-01', amountCents: 999999 }),
      ],
      10000,
      '2026-07-01',
      '2026-07-31',
    )
    // O mes inteiro entra na serie, mas so o item de julho move o saldo.
    expect(p.days).toHaveLength(31)
    expect(p.days.flatMap((d) => d.items)).toHaveLength(1)
    expect(p.days.find((d) => d.date === '2026-07-10')!.items).toHaveLength(1)
    expect(p.closingBalanceCents).toBe(5000)
  })

  it('mês sem movimento vira linha plana, não série vazia', () => {
    const p = projectCashflow([], 50000, '2026-07-01', '2026-07-31')
    expect(p.days).toHaveLength(31)
    expect(p.days.every((d) => d.balanceCents === 50000)).toBe(true)
    expect(p.days.every((d) => d.items.length === 0)).toBe(true)
    expect(p.closingBalanceCents).toBe(50000)
    expect(p.trough?.balanceCents).toBe(50000)
    expect(p.firstNegative).toBeNull()
  })

  it('não gira infinito se a janela vier invertida', () => {
    const p = projectCashflow([], 0, '2026-07-31', '2026-07-01')
    expect(p.days).toEqual([])
  })
})

describe('projectByMonth: a visão de 12 meses que a planilha nunca deu', () => {
  it('encadeia o saldo de um mês para o outro', () => {
    const p = projectByMonth(
      [
        item({ date: '2026-07-15', amountCents: 100000, direction: 'in' }),
        item({ date: '2026-07-20', amountCents: 30000 }),
        item({ date: '2026-08-15', amountCents: 100000, direction: 'in' }),
        item({ date: '2026-08-20', amountCents: 150000 }),
      ],
      0,
      '2026-07-01',
      '2026-12-31',
    )

    expect(p).toEqual([
      { month: '2026-07', openingCents: 0, closingCents: 70000, inCents: 100000, outCents: 30000, netCents: 70000 },
      { month: '2026-08', openingCents: 70000, closingCents: 20000, inCents: 100000, outCents: 150000, netCents: -50000 },
    ])
  })

  /**
   * A Parcela Carro morre em fev/2028 e o Marmore em ago/2026. Projetar
   * adiante mostra o alivio de caixa que essas quitacoes trazem, que e uma
   * pergunta que a planilha nao consegue nem formular.
   */
  it('mostra o alívio quando a parcela acaba', () => {
    const carro = (m: string) => item({ date: `${m}-12`, amountCents: 150000, label: 'Parcela Carro' })
    const renda = (m: string) => item({ date: `${m}-05`, amountCents: 200000, direction: 'in' as const, label: 'Renda' })

    const p = projectByMonth(
      [renda('2026-07'), carro('2026-07'), renda('2026-08'), carro('2026-08'), renda('2026-09')],
      0,
      '2026-07-01',
      '2026-09-30',
    )

    expect(p[2]).toMatchObject({ month: '2026-09', outCents: 0, netCents: 200000 })
  })
})

describe('upcomingCommitments', () => {
  const items = [
    item({ date: '2026-07-05', amountCents: 8959, label: 'Água', settled: true }),
    item({ date: '2026-07-12', amountCents: 150000, label: 'Parcela Carro' }),
    item({ date: '2026-07-14', amountCents: 180860, label: 'Cartão Caixa' }),
    item({ date: '2026-07-20', amountCents: 185000, label: 'Financiamento' }),
    item({ date: '2026-08-30', amountCents: 5990, label: 'Netflix' }),
    item({ date: '2026-07-15', amountCents: 600000, direction: 'in', label: 'Sendeasy' }),
  ]

  it('lista o que vence nos próximos 14 dias, por urgência', () => {
    const up = upcomingCommitments(items, '2026-07-10', 14)
    expect(up.map((i) => i.label)).toEqual(['Parcela Carro', 'Cartão Caixa', 'Financiamento'])
  })

  it('ignora o que já foi pago', () => {
    const up = upcomingCommitments(items, '2026-07-01', 30)
    expect(up.map((i) => i.label)).not.toContain('Água')
  })

  it('não lista receita: compromisso é saída', () => {
    const up = upcomingCommitments(items, '2026-07-10', 14)
    expect(up.every((i) => i.direction === 'out')).toBe(true)
  })

  it('respeita a janela', () => {
    const up = upcomingCommitments(items, '2026-07-10', 3)
    expect(up.map((i) => i.label)).toEqual(['Parcela Carro'])
  })
})
