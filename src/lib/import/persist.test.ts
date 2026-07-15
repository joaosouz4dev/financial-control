import { describe, it, expect } from 'vitest'
import { stableLabel, dedupHash, dayToISO, slugify } from './persist'
import type { ParsedEntry } from './xlsx'

describe('stableLabel', () => {
  it('remove o contador de parcela para o label ficar estável entre meses', () => {
    expect(stableLabel('Marmore 4/6', 6)).toBe('Marmore (6x)')
    expect(stableLabel('Marmore 5/6', 6)).toBe('Marmore (6x)')
  })

  /**
   * O Joao tem duas obras de marmore ao mesmo tempo: 6 parcelas de R$ 369 e
   * 5 de R$ 304. Sem o total no label as duas colapsam numa regra so, e o
   * lag() passa a alternar 369 -> 304 -> 369 inventando variacao de preco.
   */
  it('separa séries distintas que compartilham o nome', () => {
    expect(stableLabel('Marmore 5/6', 6)).not.toBe(stableLabel('Marmore 4/5', 5))
    expect(stableLabel('Marmore 5/6', 6)).toBe('Marmore (6x)')
    expect(stableLabel('Marmore 4/5', 5)).toBe('Marmore (5x)')
  })

  it('mantém a mesma série do carro entre os meses', () => {
    expect(stableLabel('Parcela Carro 05/25', 25)).toBe(stableLabel('Parcela Carro 06/25', 25))
    expect(stableLabel('Parcela Carro 06/25', 25)).toBe('Parcela Carro (25x)')
  })

  it('não mexe em descrição sem parcela', () => {
    expect(stableLabel('Netflix')).toBe('Netflix')
    expect(stableLabel('Conta de Agua', null)).toBe('Conta de Agua')
  })

  it('não engole a descrição inteira quando ela é só um contador', () => {
    expect(stableLabel('5/6', 6)).toBe('5/6')
  })
})

describe('dedupHash', () => {
  const base: ParsedEntry = {
    kind: 'expense',
    amountCents: 5990,
    amountExpression: null,
    description: 'Netflix',
    categoryRaw: 'LAZER',
    paidDay: null,
    dueDay: 30,
    row: 10,
    installment: null,
  }

  it('é estável para a mesma entrada', () => {
    expect(dedupHash('f.xlsx', base)).toBe(dedupHash('f.xlsx', base))
  })

  it('muda quando o arquivo muda', () => {
    expect(dedupHash('06.xlsx', base)).not.toBe(dedupHash('07.xlsx', base))
  })

  it('muda quando o valor muda', () => {
    expect(dedupHash('f.xlsx', base)).not.toBe(dedupHash('f.xlsx', { ...base, amountCents: 4490 }))
  })

  /**
   * "Cartão João Caixa" aparece duas vezes no mesmo mes com valores
   * diferentes: sao dois lancamentos legitimos, nao duplicata.
   */
  it('distingue linhas repetidas legítimas pela linha da planilha', () => {
    const l21 = { ...base, description: 'Cartão João Caixa', amountCents: 37508, row: 21 }
    const l22 = { ...base, description: 'Cartão João Caixa', amountCents: 180860, row: 22 }
    expect(dedupHash('f.xlsx', l21)).not.toBe(dedupHash('f.xlsx', l22))
  })
})

describe('dayToISO', () => {
  it('clampa dia 30 em fevereiro', () => {
    expect(dayToISO(2026, 2, 30)).toBe('2026-02-28')
  })

  it('respeita ano bissexto', () => {
    expect(dayToISO(2028, 2, 30)).toBe('2028-02-29')
  })

  it('clampa dia 31 em mês de 30 dias', () => {
    expect(dayToISO(2026, 4, 31)).toBe('2026-04-30')
  })

  it('devolve null sem dia', () => {
    expect(dayToISO(2026, 7, null)).toBeNull()
  })
})

describe('slugify', () => {
  it.each([
    ['ALIMENTAÇÃO', 'alimentacao'],
    ['SAÚDE', 'saude'],
    ['Cartão João Caixa', 'cartao-joao-caixa'],
    ['CASA', 'casa'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })
})
