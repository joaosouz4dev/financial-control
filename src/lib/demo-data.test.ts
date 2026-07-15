import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { isVolatileByNature, loadAllMonths, runDetectors } from './demo-data'

describe('isVolatileByNature', () => {
  it.each([
    'Cartão João Sicredi',
    'Cartão João Caixa',
    'Cartao Tauana',
    'Cartão João Revolut',
    'Fatura Nubank',
    'Parcela Carro 06/25',
    'Marmore 5/6',
  ])('exclui %s do detector de preço', (desc) => {
    expect(isVolatileByNature(desc)).toBe(true)
  })

  it.each([
    'Netflix',
    'Conta de Agua',
    'Spotify (Kotas)',
    'Financiamento Casa',
    'Internet',
    'Mercado',
  ])('mantém %s no detector de preço', (desc) => {
    expect(isVolatileByNature(desc)).toBe(false)
  })
})

describe.skipIf(!existsSync('planilhas/Controle Financeiro 07_2026.xlsx'))(
  'detectores sobre as planilhas reais',
  () => {
    it('acha Netflix e água, e não acusa fatura de cartão', async () => {
      const months = await loadAllMonths()
      const insights = runDetectors(months)
      const titles = insights.map((i) => i.title)

      expect(titles.some((t) => t.includes('Netflix') && t.includes('33,4%'))).toBe(true)
      expect(titles.some((t) => t.includes('Agua') && t.includes('22,3%'))).toBe(true)

      // Fatura de cartao nao e preco de assinatura.
      expect(titles.some((t) => /cart(ã|a)o/i.test(t))).toBe(false)
    })

    it('acusa a concentração real de receita', async () => {
      const months = await loadAllMonths()
      const insights = runDetectors(months)
      const conc = insights.find((i) => i.type === 'income_concentration')

      expect(conc?.title).toBe('Sendeasy e Vansa são 60% da sua receita')
      expect(conc?.evidence).toMatchObject({ top2Pct: 60.11 })
    })

    it('acusa OUTROS engolindo o orçamento', async () => {
      const months = await loadAllMonths()
      const insights = runDetectors(months)
      const outros = insights.find((i) => i.type === 'catch_all_category')

      expect(outros?.evidence).toMatchObject({ itemCount: 17 })
      expect(outros?.title).toContain('17 lançamentos')
    })
  },
)
