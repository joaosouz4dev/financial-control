import { describe, it, expect } from 'vitest'
import { decideMatch, scoreCandidate, levenshtein, normalize, type Candidate } from './match'

const c = (over: Partial<Candidate> & { label: string }): Candidate => ({
  ruleId: over.label.toLowerCase().replace(/\s/g, '-'),
  expectedCents: 10000,
  dueDate: '2026-07-15',
  categorySlug: 'outros',
  ...over,
})

// As regras reais dele, de julho/2026.
const PREVISTOS: Candidate[] = [
  c({ label: 'Conta de Agua', expectedCents: 8959, dueDate: '2026-07-06', categorySlug: 'casa' }),
  c({ label: 'Netflix', expectedCents: 5990, dueDate: '2026-07-30', categorySlug: 'lazer' }),
  c({ label: 'Financiamento Casa', expectedCents: 185000, dueDate: '2026-07-20', categorySlug: 'casa' }),
  c({ label: 'Internet', expectedCents: 9990, dueDate: '2026-07-21', categorySlug: 'casa' }),
  c({ label: 'Mercado', expectedCents: 220000, dueDate: '2026-07-30', categorySlug: 'alimentacao' }),
  c({ label: 'Gasolina', expectedCents: 60000, dueDate: '2026-07-20', categorySlug: 'transporte' }),
  c({ label: 'Escola Zaya', expectedCents: 35420, dueDate: '2026-07-15', categorySlug: 'outros' }),
]

describe('normalize', () => {
  it.each([
    ['Conta de Água', 'conta de agua'],
    ['  NETFLIX  ', 'netflix'],
    ['Cartão   João', 'cartao joao'],
  ])('%s -> %s', (input, expected) => {
    expect(normalize(input)).toBe(expected)
  })
})

describe('levenshtein', () => {
  it.each([
    ['netflix', 'netflix', 0],
    ['netflx', 'netflix', 1],
    ['agua', 'agua', 0],
    ['', 'abc', 3],
  ])('%s vs %s = %i', (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d)
  })
})

describe('decideMatch: o que impede duplicar lançamento', () => {
  it('"paguei 90 de agua hoje" baixa a conta de água prevista', () => {
    const d = decideMatch('agua', 9000, '2026-07-05', PREVISTOS)
    expect(d.matched?.candidate.label).toBe('Conta de Agua')
    expect(d.isNew).toBe(false)
    expect(d.matched!.score).toBeGreaterThanOrEqual(0.7)
  })

  it('casa mesmo com o valor diferente do previsto: a conta varia todo mês', () => {
    // Previsto 89,59; veio 102,30. É a mesma conta.
    const d = decideMatch('agua', 10230, '2026-07-06', PREVISTOS)
    expect(d.matched?.candidate.label).toBe('Conta de Agua')
  })

  it('tolera typo', () => {
    const d = decideMatch('netflx', 5990, '2026-07-30', PREVISTOS)
    expect(d.matched?.candidate.label).toBe('Netflix')
  })

  it('casa por palavra em comum', () => {
    const d = decideMatch('financiamento', 185000, '2026-07-20', PREVISTOS)
    expect(d.matched?.candidate.label).toBe('Financiamento Casa')
  })

  it('lançamento que não existe é novo, não força casamento', () => {
    const d = decideMatch('cinema', 5000, '2026-07-15', PREVISTOS)
    expect(d.isNew).toBe(true)
    expect(d.matched).toBeNull()
  })

  /**
   * Ele tem DOIS "Cartao Joao Caixa" com valores diferentes. Casar no chute
   * corrompe o historico em silencio; perguntar custa uma interacao.
   */
  it('pergunta quando há dois candidatos empatados', () => {
    const ambiguos: Candidate[] = [
      c({ label: 'Cartão João Caixa', ruleId: 'a', expectedCents: 37508, dueDate: '2026-07-14' }),
      c({ label: 'Cartão João Caixa', ruleId: 'b', expectedCents: 180860, dueDate: '2026-07-14' }),
    ]
    const d = decideMatch('cartao joao caixa', null, '2026-07-14', ambiguos)
    expect(d.matched).toBeNull()
    expect(d.alternatives).toHaveLength(2)
    expect(d.isNew).toBe(false)
  })

  it('desempata quando o valor identifica qual dos dois', () => {
    const ambiguos: Candidate[] = [
      c({ label: 'Cartão João Caixa', ruleId: 'a', expectedCents: 37508, dueDate: '2026-07-14' }),
      c({ label: 'Cartão João Sicredi', ruleId: 'b', expectedCents: 96102, dueDate: '2026-07-25' }),
    ]
    const d = decideMatch('cartao joao caixa', 37508, '2026-07-14', ambiguos)
    expect(d.matched?.candidate.ruleId).toBe('a')
  })

  it('sem valor ainda casa pelo nome ("paguei a internet")', () => {
    const d = decideMatch('internet', null, '2026-07-21', PREVISTOS)
    expect(d.matched?.candidate.label).toBe('Internet')
  })

  it('não casa nomes diferentes que compartilham prefixo curto', () => {
    const d = decideMatch('gas', 5000, '2026-07-20', PREVISTOS)
    // "gas" não deve virar "Gasolina" no automático.
    expect(d.matched).toBeNull()
  })
})

describe('scoreCandidate: a evidência do casamento', () => {
  it('explica por que casou', () => {
    const m = scoreCandidate('agua', 8959, '2026-07-06', PREVISTOS[0]!)
    expect(m.reasons).toContain('valor exato')
    expect(m.reasons).toContain('perto do vencimento')
  })

  it('sinaliza quando o valor destoa', () => {
    const m = scoreCandidate('netflix', 20000, '2026-07-30', PREVISTOS[1]!)
    expect(m.reasons.some((r) => r.includes('destoa'))).toBe(true)
  })

  it('nome que não bate zera o score', () => {
    const m = scoreCandidate('uber', 5000, '2026-07-15', PREVISTOS[1]!)
    expect(m.score).toBe(0)
  })
})
