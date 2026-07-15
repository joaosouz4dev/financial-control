import { describe, it, expect } from 'vitest'
import { checkinMonth, type AcceptedItem, type ActualSpend } from './track'

const ACEITOS: AcceptedItem[] = [
  { itemId: 'i1', ruleId: 'crunchy', label: 'Crunchyroll', savingCents: 2000, baselineCents: 2000, kind: 'cancel' },
  { itemId: 'i2', ruleId: 'revolut', label: 'Revolut Metal', savingCents: 7999, baselineCents: 7999, kind: 'cancel' },
  { itemId: 'i3', ruleId: 'mercado', label: 'Mercado', savingCents: 33000, baselineCents: 220000, kind: 'reduce' },
]

describe('checkinMonth: o sistema cobra', () => {
  it('cancelamento cumprido: sumiu do mês', () => {
    const actual: ActualSpend[] = [{ ruleId: 'mercado', label: 'Mercado', amountCents: 187000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)

    const crunchy = c.items.find((i) => i.itemId === 'i1')!
    expect(crunchy.status).toBe('kept')
    expect(crunchy.savedCents).toBe(2000)
  })

  it('cancelamento quebrado: voltou a aparecer', () => {
    const actual: ActualSpend[] = [{ ruleId: 'crunchy', label: 'Crunchyroll', amountCents: 2000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)

    const crunchy = c.items.find((i) => i.itemId === 'i1')!
    expect(crunchy.status).toBe('broken')
    expect(crunchy.note).toContain('voltou a aparecer')
    expect(crunchy.savedCents).toBe(0)
  })

  it('redução cumprida: gastou dentro do alvo', () => {
    // Alvo: 2200 - 330 = 1870.
    const actual: ActualSpend[] = [{ ruleId: 'mercado', label: 'Mercado', amountCents: 187000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)

    const mercado = c.items.find((i) => i.itemId === 'i3')!
    expect(mercado.status).toBe('kept')
    expect(mercado.savedCents).toBe(33000)
  })

  it('redução parcial: reduziu, mas menos que o combinado', () => {
    const actual: ActualSpend[] = [{ ruleId: 'mercado', label: 'Mercado', amountCents: 210000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)

    const mercado = c.items.find((i) => i.itemId === 'i3')!
    expect(mercado.status).toBe('partial')
    expect(mercado.savedCents).toBe(10000) // economizou R$ 100 dos R$ 330
    expect(mercado.note).toContain('menos do que combinou')
  })

  it('redução quebrada: gastou mais que antes', () => {
    const actual: ActualSpend[] = [{ ruleId: 'mercado', label: 'Mercado', amountCents: 250000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)

    const mercado = c.items.find((i) => i.itemId === 'i3')!
    expect(mercado.status).toBe('broken')
    expect(mercado.savedCents).toBe(0)
  })

  it('tolera 5% para não ser implicante com centavo', () => {
    // Alvo 1870, gastou 1900: 1,6% acima. Conta como cumprido.
    const actual: ActualSpend[] = [{ ruleId: 'mercado', label: 'Mercado', amountCents: 190000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)
    expect(c.items.find((i) => i.itemId === 'i3')!.status).toBe('kept')
  })

  it('redução que sumiu é suspeita, não sucesso', () => {
    // O mercado não deixa de existir: se sumiu, algo está errado no dado.
    const c = checkinMonth('2026-08', [ACEITOS[2]!], [])
    expect(c.items[0]!.status).toBe('unknown')
    expect(c.items[0]!.savedCents).toBe(0)
  })

  it('casa por label quando não há ruleId', () => {
    const semRegra: AcceptedItem[] = [
      { itemId: 'x', ruleId: null, label: 'Crunchyroll', savingCents: 2000, baselineCents: 2000, kind: 'cancel' },
    ]
    const c = checkinMonth('2026-08', semRegra, [{ ruleId: null, label: 'crunchyroll', amountCents: 2000 }])
    expect(c.items[0]!.status).toBe('broken')
  })

  it('agrega o veredito do mês', () => {
    const actual: ActualSpend[] = [{ ruleId: 'mercado', label: 'Mercado', amountCents: 187000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)

    expect(c.promisedCents).toBe(2000 + 7999 + 33000)
    expect(c.savedCents).toBe(2000 + 7999 + 33000)
    expect(c.onTrack).toBe(true)
    expect(c.keptCount).toBe(3)
    expect(c.brokenCount).toBe(0)
  })

  it('diz quando saiu do trilho', () => {
    const actual: ActualSpend[] = [
      { ruleId: 'crunchy', label: 'Crunchyroll', amountCents: 2000 },
      { ruleId: 'revolut', label: 'Revolut Metal', amountCents: 7999 },
      { ruleId: 'mercado', label: 'Mercado', amountCents: 250000 },
    ]
    const c = checkinMonth('2026-08', ACEITOS, actual)

    expect(c.onTrack).toBe(false)
    expect(c.brokenCount).toBe(3)
    expect(c.savedCents).toBe(0)
  })

  /**
   * Gastar mais num item nao "des-economiza" o que outro item economizou: o
   * total nunca fica negativo, so nao conta.
   */
  it('estouro em um item não anula a economia de outro', () => {
    const actual: ActualSpend[] = [{ ruleId: 'mercado', label: 'Mercado', amountCents: 300000 }]
    const c = checkinMonth('2026-08', ACEITOS, actual)
    expect(c.savedCents).toBe(2000 + 7999) // os dois cancelamentos contam
  })
})
