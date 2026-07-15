import { describe, it, expect } from 'vitest'
import { evaluateFormula, evaluateToCents, normalizeNumber, FormulaError } from './evaluate'

describe('normalizeNumber', () => {
  it.each([
    ['5.1', '5.1'],
    ['59,90', '59.90'],
    ['1.850,50', '1850.50'],
    ['1,234.56', '1234.56'],
    ['354,20', '354.20'],
    ['80', '80'],
  ])('normaliza %s -> %s', (input, expected) => {
    expect(normalizeNumber(input)).toBe(expected)
  })
})

describe('formulas reais das planilhas do Joao', () => {
  it.each([
    ['=2*75', 150],
    ['=4*550', 2200],
    ['=2*48', 96],
    ['=11*4', 44],
    ['=2.86*6.5', 18.59],
    ['=2.66*6.5', 17.29],
    ['=7.95', 7.95],
    ['=20', 20],
    ['=79.99', 79.99],
    // Sendeasy Cursor: 60 USD * 5.1 + 10% de taxa
    ['=(60*5.1)+(60*5.1)*0.1', 336.6],
  ])('%s = %s', (formula, expected) => {
    expect(evaluateFormula(formula).toNumber()).toBeCloseTo(expected, 2)
  })
})

describe('evaluateToCents', () => {
  it('converte sem erro de float', () => {
    expect(evaluateToCents('=0.1+0.2')).toBe(30)
    expect(evaluateToCents('=59,90')).toBe(5990)
    expect(evaluateToCents('=4*550')).toBe(220000)
    expect(evaluateToCents('=2.86*6.5')).toBe(1859)
  })

  it('arredonda meio-para-cima', () => {
    expect(evaluateToCents('=0.005')).toBe(1)
    // 2.66*6.5 = 17.29 exato
    expect(evaluateToCents('=2.66*6.5')).toBe(1729)
  })

  it('aceita valor sem sinal de igual', () => {
    expect(evaluateToCents('89,59')).toBe(8959)
  })

  it('respeita precedencia e parenteses', () => {
    expect(evaluateFormula('=2+3*4').toNumber()).toBe(14)
    expect(evaluateFormula('=(2+3)*4').toNumber()).toBe(20)
  })

  it('aceita unario negativo', () => {
    expect(evaluateFormula('=-5+10').toNumber()).toBe(5)
  })
})

describe('rejeita entrada perigosa ou invalida', () => {
  it.each([
    'process.exit(1)',
    'require("fs")',
    '=1+',
    '=(1+2',
    '=1/0',
    '=',
    '=SUM(A1:A10)',
  ])('rejeita %s', (bad) => {
    expect(() => evaluateFormula(bad)).toThrow(FormulaError)
  })
})
