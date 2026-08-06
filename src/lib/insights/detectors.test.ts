import { describe, it, expect } from 'vitest'
import {
  detectPriceChanges,
  detectGoalBreaches,
  detectIncomeConcentration,
  detectAnomaly,
  detectOrphanSubscriptions,
  detectNegativeCashflow,
  detectCatchAllCategory,
} from './detectors'

describe('detectPriceChanges', () => {
  it('pega a Netflix subindo de 44,90 para 59,90', () => {
    const out = detectPriceChanges([
      { ruleId: 'netflix', label: 'Netflix', month: '2026-06', amountCents: 4490 },
      { ruleId: 'netflix', label: 'Netflix', month: '2026-07', amountCents: 5990 },
    ])

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'price_change',
      severity: 'warn',
      fingerprint: 'price_change:netflix:2026-07',
    })
    expect(out[0]!.title).toBe('Netflix passou de R$ 44,90 para R$ 59,90 (+33,4%)')
    expect(out[0]!.evidence).toMatchObject({
      deltaCents: 1500,
      deltaPct: 33.41,
      annualImpactCents: 18000, // R$ 180/ano
    })
  })

  it('pega a agua subindo 22%', () => {
    const out = detectPriceChanges([
      { ruleId: 'agua', label: 'Conta de Agua', month: '2026-06', amountCents: 7328 },
      { ruleId: 'agua', label: 'Conta de Agua', month: '2026-07', amountCents: 8959 },
    ])
    expect(out[0]!.evidence).toMatchObject({ deltaCents: 1631, deltaPct: 22.26 })
  })

  it('ignora variacao pequena (ruido)', () => {
    const out = detectPriceChanges([
      { ruleId: 'x', label: 'X', month: '2026-06', amountCents: 10000 },
      { ruleId: 'x', label: 'X', month: '2026-07', amountCents: 10200 }, // +2%
    ])
    expect(out).toEqual([])
  })

  it('ignora centavos mesmo com pct alto', () => {
    const out = detectPriceChanges([
      { ruleId: 'x', label: 'X', month: '2026-06', amountCents: 100 },
      { ruleId: 'x', label: 'X', month: '2026-07', amountCents: 150 }, // +50% mas R$ 0,50
    ])
    expect(out).toEqual([])
  })

  it('separa alta do dolar de aumento de preco', () => {
    // Microsoft 365: 2.86 USD. Cambio 6.5 -> 7.5. Preco em USD nao mudou.
    const out = detectPriceChanges([
      { ruleId: 'ms365', label: 'Microsoft 365', month: '2026-06', amountCents: 1859, fxRate: 6.5 },
      { ruleId: 'ms365', label: 'Microsoft 365', month: '2026-07', amountCents: 2145, fxRate: 7.5 },
    ])
    expect(out[0]).toMatchObject({ type: 'fx_change' })
    expect(out[0]!.evidence).toMatchObject({ fxDriven: true })
    expect(out[0]!.title).toContain('câmbio')
  })

  it('acusa aumento real mesmo com cambio estavel', () => {
    const out = detectPriceChanges([
      { ruleId: 'ms365', label: 'Microsoft 365', month: '2026-06', amountCents: 1859, fxRate: 6.5 },
      { ruleId: 'ms365', label: 'Microsoft 365', month: '2026-07', amountCents: 2600, fxRate: 6.5 },
    ])
    expect(out[0]).toMatchObject({ type: 'price_change' })
    expect(out[0]!.evidence).toMatchObject({ fxDriven: false })
  })

  it('detecta em serie longa, um insight por mudanca', () => {
    const out = detectPriceChanges([
      { ruleId: 'n', label: 'Netflix', month: '2026-01', amountCents: 3990 },
      { ruleId: 'n', label: 'Netflix', month: '2026-02', amountCents: 3990 },
      { ruleId: 'n', label: 'Netflix', month: '2026-03', amountCents: 4490 },
      { ruleId: 'n', label: 'Netflix', month: '2026-07', amountCents: 5990 },
    ])
    expect(out).toHaveLength(2)
    expect(out.map((o) => o.evidence.toMonth)).toEqual(['2026-03', '2026-07'])
  })
})

describe('detectGoalBreaches', () => {
  const income = 1829860 // R$ 18.298,60 real dele

  it('acusa alimentacao acima da meta de 25%', () => {
    const out = detectGoalBreaches('2026-07', income, [
      { categoryId: 'alim', categoryName: 'Alimentação', spentCents: 700000, goalPct: 25 },
    ])
    // meta = 4.574,65 | gasto = 7.000
    expect(out[0]).toMatchObject({ type: 'goal_exceeded', severity: 'critical' })
    expect(out[0]!.evidence).toMatchObject({ goalCents: 457465, overCents: 242535 })
  })

  it('nao acusa dentro da tolerancia', () => {
    const out = detectGoalBreaches('2026-07', income, [
      { categoryId: 'casa', categoryName: 'Casa', spentCents: 380000, goalPct: 20 },
    ])
    expect(out).toEqual([])
  })

  it('ignora categoria sem meta', () => {
    const out = detectGoalBreaches('2026-07', income, [
      { categoryId: 'x', categoryName: 'X', spentCents: 999999, goalPct: null },
    ])
    expect(out).toEqual([])
  })

  it('nao divide por zero sem receita', () => {
    expect(detectGoalBreaches('2026-07', 0, [
      { categoryId: 'a', categoryName: 'A', spentCents: 100, goalPct: 25 },
    ])).toEqual([])
  })
})

describe('detectIncomeConcentration', () => {
  it('acusa Sendeasy + Vansa como 61% da receita', () => {
    const out = detectIncomeConcentration('2026-07', [
      { label: 'Sendeasy', amountCents: 600000 },
      { label: 'Vansa', amountCents: 500000 },
      { label: 'MatchMaking Bot', amountCents: 400000 },
      { label: 'Upmoney Capital', amountCents: 150000 },
      { label: 'Aluguel Pururuca', amountCents: 75000 },
      { label: 'Wppconnect Wipsites', amountCents: 64000 },
    ])

    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('Sendeasy e Vansa são 61% da sua receita')
    expect(out[0]!.evidence).toMatchObject({ top2Pct: 61.49 })
    expect(out[0]!.severity).toBe('warn')
  })

  it('marca critical acima de 70%', () => {
    const out = detectIncomeConcentration('2026-07', [
      { label: 'A', amountCents: 800000 },
      { label: 'B', amountCents: 100000 },
      { label: 'C', amountCents: 50000 },
    ])
    expect(out[0]!.severity).toBe('critical')
  })

  it('nao acusa receita bem distribuida', () => {
    const out = detectIncomeConcentration('2026-07', [
      { label: 'A', amountCents: 100000 },
      { label: 'B', amountCents: 100000 },
      { label: 'C', amountCents: 100000 },
      { label: 'D', amountCents: 100000 },
      { label: 'E', amountCents: 100000 },
    ])
    expect(out).toEqual([])
  })
})

describe('detectAnomaly', () => {
  const hist = [
    { month: '2026-01', amountCents: 60000 },
    { month: '2026-02', amountCents: 61000 },
    { month: '2026-03', amountCents: 59500 },
    { month: '2026-04', amountCents: 60500 },
    { month: '2026-05', amountCents: 60000 },
  ]

  it('acusa gasolina disparando', () => {
    const out = detectAnomaly('Gasolina', hist, { month: '2026-06', amountCents: 120000 })
    expect(out).toHaveLength(1)
    expect(out[0]!.evidence).toMatchObject({ medianCents: 60000, currentCents: 120000 })
  })

  it('nao acusa variacao normal', () => {
    expect(detectAnomaly('Gasolina', hist, { month: '2026-06', amountCents: 61000 })).toEqual([])
  })

  it('nao roda com historico curto', () => {
    expect(detectAnomaly('X', hist.slice(0, 2), { month: '2026-06', amountCents: 999999 })).toEqual([])
  })

  it('MAD e robusto: um outlier no historico nao mascara o proximo', () => {
    const withOutlier = [...hist, { month: '2026-06', amountCents: 500000 }]
    const out = detectAnomaly('Gasolina', withOutlier, { month: '2026-07', amountCents: 130000 })
    // Media+desvio seria contaminada pelo 500k. MAD nao: ainda acusa.
    expect(out).toHaveLength(1)
  })

  it('historico constante: qualquer mudanca material e suspeita', () => {
    const flat = [
      { month: '2026-01', amountCents: 5390 },
      { month: '2026-02', amountCents: 5390 },
      { month: '2026-03', amountCents: 5390 },
      { month: '2026-04', amountCents: 5390 },
    ]
    const out = detectAnomaly('Youtube Prime', flat, { month: '2026-05', amountCents: 7000 })
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toContain('constante')
  })

  it('historico constante: ignora troco', () => {
    const flat = Array.from({ length: 5 }, (_, i) => ({ month: `2026-0${i + 1}`, amountCents: 5390 }))
    expect(detectAnomaly('Youtube Prime', flat, { month: '2026-06', amountCents: 5400 })).toEqual([])
  })
})

describe('detectOrphanSubscriptions', () => {
  it('pergunta em vez de afirmar', () => {
    const out = detectOrphanSubscriptions([
      { ruleId: 'crunchy', label: 'Crunchyroll', amountCents: 2000, categoryName: 'Lazer', monthsSinceSignal: 5 },
    ])
    expect(out[0]!.title).toBe('Crunchyroll (R$ 20,00/mês): ainda usa?')
    expect(out[0]!.severity).toBe('info')
    expect(out[0]!.evidence).toMatchObject({ annualCents: 24000 })
  })

  it('ignora assinatura com sinal recente', () => {
    expect(detectOrphanSubscriptions([
      { ruleId: 'n', label: 'Netflix', amountCents: 5990, categoryName: 'Lazer', monthsSinceSignal: 0 },
    ])).toEqual([])
  })

  it('ignora quando nunca houve sinal (nao inventa)', () => {
    expect(detectOrphanSubscriptions([
      { ruleId: 'x', label: 'X', amountCents: 1000, categoryName: null, monthsSinceSignal: null },
    ])).toEqual([])
  })
})

describe('detectNegativeCashflow', () => {
  it('acha o primeiro dia negativo e o pior', () => {
    const out = detectNegativeCashflow([
      { date: '2026-07-01', balanceCents: 500000 },
      { date: '2026-07-12', balanceCents: 100000 },
      { date: '2026-07-20', balanceCents: -50000 },
      { date: '2026-07-25', balanceCents: -120000 },
      { date: '2026-07-30', balanceCents: 300000 },
    ])
    expect(out[0]!.evidence).toMatchObject({
      firstNegativeDate: '2026-07-20',
      worstDate: '2026-07-25',
      worstCents: -120000,
    })
    expect(out[0]!.title).toBe('Saldo fica negativo em 20/07/2026 (-R$ 500,00)')
  })

  it('silencia quando o saldo nunca fica negativo', () => {
    expect(detectNegativeCashflow([
      { date: '2026-07-01', balanceCents: 100 },
      { date: '2026-07-02', balanceCents: 200 },
    ])).toEqual([])
  })
})

describe('detectCatchAllCategory', () => {
  it('acusa OUTROS engolindo o orcamento', () => {
    const out = detectCatchAllCategory('2026-07', 'Outros', 'outros', 17, 470000, 1829860, 5)
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('"Outros" concentra 17 lançamentos e 26% da receita')
    expect(out[0]!.evidence).toMatchObject({ itemCount: 17, sharePct: 25.69, goalPct: 5 })
  })

  it('nao acusa categoria pequena', () => {
    expect(detectCatchAllCategory('2026-07', 'Lazer', 'lazer', 3, 50000, 1829860, 12)).toEqual([])
  })

  it('nao acusa quando o gasto respeita a meta', () => {
    expect(detectCatchAllCategory('2026-07', 'Casa', 'casa', 10, 300000, 1829860, 20)).toEqual([])
  })
})
