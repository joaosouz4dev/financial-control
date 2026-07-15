import { describe, it, expect } from 'vitest'
import {
  untouchableReason,
  estimatePain,
  proposeCandidates,
  buildPlan,
  type Expense,
} from './candidates'

const e = (over: Partial<Expense> & { label: string; amountCents: number }): Expense => ({
  ruleId: over.label.toLowerCase().replace(/\s/g, '-'),
  categorySlug: 'outros',
  monthsSinceSignal: null,
  isInstallment: false,
  ...over,
})

// As despesas reais dele, julho/2026.
const DESPESAS: Expense[] = [
  e({ label: 'Financiamento Casa', amountCents: 185000, categorySlug: 'casa' }),
  e({ label: 'Cartão João Caixa #2', amountCents: 180860 }),
  e({ label: 'Mercado', amountCents: 220000, categorySlug: 'alimentacao' }),
  e({ label: 'Parcela Carro', amountCents: 150000, categorySlug: 'transporte', isInstallment: true }),
  e({ label: 'Gasolina', amountCents: 60000, categorySlug: 'transporte' }),
  e({ label: 'Escola Zaya', amountCents: 35420 }),
  e({ label: 'Seguro carro', amountCents: 22000, categorySlug: 'transporte' }),
  e({ label: 'Vercel', amountCents: 11000 }),
  e({ label: 'Lenços Zaya', amountCents: 10000 }),
  e({ label: 'Internet', amountCents: 9990, categorySlug: 'casa' }),
  e({ label: 'Leite Zaya', amountCents: 9600, categorySlug: 'alimentacao' }),
  e({ label: 'DAS Empresa', amountCents: 8705 }),
  e({ label: 'Fraldas Zaya', amountCents: 8000 }),
  e({ label: 'Revolut Metal', amountCents: 7999 }),
  e({ label: 'Conta de Agua', amountCents: 8959, categorySlug: 'casa' }),
  e({ label: 'Youtube Prime', amountCents: 5390, categorySlug: 'lazer' }),
  e({ label: 'Netflix', amountCents: 5990, categorySlug: 'lazer' }),
  e({ label: 'Crunchyroll', amountCents: 2000, monthsSinceSignal: 5 }),
  e({ label: 'Meli+', amountCents: 990, categorySlug: 'lazer' }),
  e({ label: 'Spotify (Kotas)', amountCents: 932, categorySlug: 'lazer' }),
  e({ label: 'iFood', amountCents: 795, categorySlug: 'lazer' }),
]

describe('untouchableReason: o que o sistema nunca sugere cortar', () => {
  /**
   * Um algoritmo ingenuo ordena por valor e sugere "Fraldas Zaya R$ 80" antes
   * de "Revolut Metal R$ 79,99", porque 80 > 79,99. Sugerir cortar fralda de
   * bebe destroi a confianca no sistema inteiro.
   */
  it.each([
    ['Fraldas Zaya', 'gasto com a filha'],
    ['Leite Zaya', 'gasto com a filha'],
    ['Escola Zaya', 'gasto com a filha'],
    ['Material Zaya', 'gasto com a filha'],
    ['Lenços Zaya', 'gasto com a filha'],
  ])('nunca sugere cortar %s', (label, why) => {
    expect(untouchableReason(label)).toBe(why)
  })

  it.each([
    ['Financiamento Casa', 'moradia'],
    ['Aluguel Pururuca', 'moradia'],
    ['Conta de Agua', 'conta essencial de casa'],
    ['Conta de Luz', 'conta essencial de casa'],
    ['Seguro carro', 'seguro'],
    ['DAS Empresa', 'obrigação fiscal'],
    ['Plano de Saúde', 'saúde'],
  ])('nunca sugere cortar %s (%s)', (label, why) => {
    expect(untouchableReason(label)).toBe(why)
  })

  /**
   * Fatura de cartao nao e assinatura: e o agregado das compras. "Cancelar
   * Cartão João Caixa, economize R$ 1.808,60/mes" e absurdo: cancelar o cartao
   * nao apaga a divida, e esse dinheiro ja esta contado nas categorias das
   * compras. Contaria economia que nao existe.
   */
  it.each([
    'Cartão João Caixa',
    'Cartão João Caixa #2',
    'Cartão João Sicredi',
    'Cartao Tauana',
    'Fatura Nubank',
  ])('nunca sugere cancelar %s: é agregado de compras, não assinatura', (label) => {
    expect(untouchableReason(label)).toContain('itemize')
  })

  it.each(['Netflix', 'Crunchyroll', 'Vercel', 'Revolut Metal', 'Mercado', 'Gasolina'])(
    '%s é passível de análise',
    (label) => {
      expect(untouchableReason(label)).toBeNull()
    },
  )
})

describe('estimatePain: dor é o que ele perde, não o que custa', () => {
  it('assinatura sem sinal de uso não dói', () => {
    expect(estimatePain(e({ label: 'Crunchyroll', amountCents: 2000, monthsSinceSignal: 5 }))).toBe(1)
  })

  it('assinatura redundante dói pouco', () => {
    expect(estimatePain(e({ label: 'Crunchyroll', amountCents: 2000 }))).toBe(2)
  })

  it('ferramenta de trabalho dói: pode custar receita', () => {
    expect(estimatePain(e({ label: 'Vercel', amountCents: 11000 }))).toBe(4)
    expect(estimatePain(e({ label: 'Sendeasy Cursor', amountCents: 33660 }))).toBe(4)
  })

  it('mercado e gasolina doem: são comprimíveis, não descartáveis', () => {
    expect(estimatePain(e({ label: 'Mercado', amountCents: 220000, categorySlug: 'alimentacao' }))).toBe(4)
    expect(estimatePain(e({ label: 'Gasolina', amountCents: 60000, categorySlug: 'transporte' }))).toBe(4)
  })

  it('sinal de uso vence a heurística do nome', () => {
    // Netflix normalmente é dor 3, mas sem uso há 5 meses é dor 1.
    expect(estimatePain(e({ label: 'Netflix', amountCents: 5990, monthsSinceSignal: 5 }))).toBe(1)
  })
})

describe('proposeCandidates', () => {
  const props = proposeCandidates(DESPESAS)

  it('não propõe nada da Zaya, nem moradia, nem saúde, nem imposto', () => {
    const labels = props.map((p) => p.label)
    for (const proibido of [
      'Fraldas Zaya', 'Leite Zaya', 'Escola Zaya', 'Lenços Zaya',
      'Financiamento Casa', 'Conta de Agua', 'Seguro carro', 'DAS Empresa',
      'Cartão João Caixa #2',
    ]) {
      expect(labels).not.toContain(proibido)
    }
  })

  it('não propõe cortar parcelamento: é dívida contratada', () => {
    expect(props.map((p) => p.label)).not.toContain('Parcela Carro')
  })

  /**
   * Dividir por dor era penalidade fraca demais: a Vercel (R$ 110, dor 4,
   * ferramenta de trabalho) ficava ACIMA do Crunchyroll (R$ 20, dor 1, sem uso
   * ha 5 meses), porque 110/4 > 20/1. Com dor exponencial (base 4) o
   * Crunchyroll lidera, que e a ordem que um humano daria.
   */
  it('a assinatura morta lidera, mesmo valendo 5x menos que a ferramenta de trabalho', () => {
    expect(props[0]!.label).toBe('Crunchyroll')
    const vercel = props.findIndex((p) => p.label === 'Vercel')
    expect(vercel).toBeGreaterThan(2)
  })

  it('o que dói só aparece quando a economia é muito maior', () => {
    const netflix = props.find((p) => p.label === 'Netflix')!  // dor 3, R$ 59,90
    const gasolina = props.find((p) => p.label === 'Gasolina')! // dor 4, R$ 90
    // Gasolina economiza 50% mais e ainda assim vem depois: dor 4 custa 4x dor 3.
    expect(netflix.score).toBeGreaterThan(gasolina.score)
  })

  it('mercado e gasolina viram redução, não cancelamento', () => {
    const mercado = props.find((p) => p.label === 'Mercado')
    expect(mercado?.kind).toBe('reduce')
    expect(mercado?.savingCents).toBe(33000) // 15% de 2200
    expect(mercado?.reason).toContain('sem cortar')
  })

  it('assinatura vira cancelamento', () => {
    expect(props.find((p) => p.label === 'Crunchyroll')?.kind).toBe('cancel')
  })

  it('cita a evidência do órfão', () => {
    expect(props.find((p) => p.label === 'Crunchyroll')?.reason).toContain('5 meses')
  })

  it('ignora troco que não move o ponteiro', () => {
    expect(props.map((p) => p.label)).not.toContain('iFood') // R$ 7,95: abaixo do piso de R$ 10
  })

  it('calcula o impacto anual', () => {
    const netflix = props.find((p) => p.label === 'Netflix')
    expect(netflix?.annualCents).toBe(5990 * 12)
  })
})

describe('buildPlan: "quero economizar 2k/mês"', () => {
  it('monta o plano pegando os cortes menos dolorosos primeiro', () => {
    const plan = buildPlan(DESPESAS, 200000) // R$ 2.000
    expect(plan.items.length).toBeGreaterThan(0)
    // Nada da Zaya entrou.
    expect(plan.items.every((i) => !/zaya/i.test(i.label))).toBe(true)
  })

  it('diz que não chega em vez de fingir', () => {
    // R$ 50 mil/mês é impossível com essas despesas.
    const plan = buildPlan(DESPESAS, 5000000)
    expect(plan.reached).toBe(false)
    expect(plan.gapCents).toBeGreaterThan(0)
  })

  it('para assim que atinge a meta', () => {
    const plan = buildPlan(DESPESAS, 2000) // R$ 20: um corte resolve
    expect(plan.reached).toBe(true)
    expect(plan.items).toHaveLength(1)
  })

  it('reporta a dor média do plano', () => {
    const plan = buildPlan(DESPESAS, 5000)
    expect(plan.avgPain).toBeGreaterThan(0)
    expect(plan.avgPain).toBeLessThanOrEqual(5)
  })

  it('meta zero não propõe nada', () => {
    expect(buildPlan(DESPESAS, 0).items).toEqual([])
  })
})

describe('a trava estrutural: categoria essencial nunca é cancelada', () => {
  /**
   * A lista de regex sempre vai ter buracos: eu esqueci os cachorros e a
   * internet na primeira versao. Esta trava nao depende de adivinhar nomes.
   */
  it.each([
    ['casa', 'Algum gasto de casa'],
    ['saude', 'Algum gasto de saúde'],
    ['alimentacao', 'Algum gasto de comida'],
    ['transporte', 'Algum gasto de transporte'],
  ])('categoria %s só permite redução, nunca cancelamento', (slug, label) => {
    const props = proposeCandidates([
      e({ label, amountCents: 50000, categorySlug: slug }),
    ])
    expect(props[0]?.kind).toBe('reduce')
  })

  it('categoria não essencial permite cancelamento', () => {
    const props = proposeCandidates([
      e({ label: 'Alguma assinatura', amountCents: 5000, categorySlug: 'lazer' }),
    ])
    expect(props[0]?.kind).toBe('cancel')
  })
})

describe('o que a lista de intocáveis esqueceu na primeira versão', () => {
  /**
   * O plano real sugeria "Cancelar Ração Cachorros, economize R$ 150/mes" em
   * PRIMEIRO lugar, e "Cancelar Internet" logo depois. Os cachorros comem, e
   * ele trabalha de casa: os dois sao economia real e conselho inaceitavel.
   */
  it.each([
    ['Ração Cachorros 18kg', 'animal de estimação'],
    ['Veterinário', 'animal de estimação'],
    ['Internet', 'infraestrutura de trabalho'],
    ['Celular João (Vivo)', 'infraestrutura de trabalho'],
    ['Celular Tauana (Vivo)', 'infraestrutura de trabalho'],
  ])('nunca sugere cortar %s (%s)', (label, why) => {
    expect(untouchableReason(label)).toBe(why)
  })

  it('nenhum deles aparece numa proposta real', () => {
    const props = proposeCandidates([
      e({ label: 'Ração Cachorros 18kg', amountCents: 15000 }),
      e({ label: 'Internet', amountCents: 9990, categorySlug: 'casa' }),
      e({ label: 'Celular João (Vivo)', amountCents: 3500 }),
      e({ label: 'Crunchyroll', amountCents: 2000, categorySlug: 'lazer' }),
    ])
    expect(props.map((p) => p.label)).toEqual(['Crunchyroll'])
  })
})
