import { describe, expect, it } from 'vitest'
import {
  CATEGORY_PALETTE,
  NEUTRAL_SLOT,
  nextFreeSlot,
  resolveColors,
  slotByKey,
  slugify,
} from './palette'

describe('paleta de categorias', () => {
  it('nao repete cor entre slots, em nenhum dos dois temas', () => {
    const light = CATEGORY_PALETTE.map((s) => s.light)
    const dark = CATEGORY_PALETTE.map((s) => s.dark)
    expect(new Set(light).size).toBe(light.length)
    // Verde e o unico passo que serve aos dois temas sem mudar.
    expect(new Set(dark).size).toBe(dark.length)
  })

  it('cor desconhecida cai no cinza, nao quebra', () => {
    expect(slotByKey('cor-que-nao-existe')).toBe(NEUTRAL_SLOT)
    expect(slotByKey(null)).toBe(NEUTRAL_SLOT)
  })

  it('atribui slots em ordem fixa, sem ciclar', () => {
    expect(nextFreeSlot([]).key).toBe('blue')
    expect(nextFreeSlot(['blue']).key).toBe('orange')
    expect(nextFreeSlot(['blue', 'orange', 'aqua']).key).toBe('yellow')
  })

  it('passado o fim da paleta cai no cinza, sem inventar hue', () => {
    const todos = CATEGORY_PALETTE.map((s) => s.key)
    expect(nextFreeSlot(todos)).toBe(NEUTRAL_SLOT)
  })

  it('arquivar uma categoria nao repinta as outras', () => {
    // O slot livre depende de quem AINDA usa a cor, nao da posicao na lista.
    expect(nextFreeSlot(['blue', 'aqua']).key).toBe('orange')
  })

  it('le tanto chave de slot quanto o hex antigo semeado no banco', () => {
    expect(resolveColors('blue', null).light).toBe('#2a78d6')
    expect(resolveColors('#6d28d9', null)).toEqual({ light: '#6d28d9', dark: '#6d28d9' })
    expect(resolveColors('#6d28d9', '#a78bfa')).toEqual({ light: '#6d28d9', dark: '#a78bfa' })
  })
})

describe('slugify', () => {
  it('tira acento e espaco', () => {
    expect(slugify('Alimentação')).toBe('alimentacao')
    expect(slugify('Saúde da Zaya')).toBe('saude-da-zaya')
    expect(slugify('Cartão  João')).toBe('cartao-joao')
  })

  it('nao deixa hifen sobrando nas pontas', () => {
    expect(slugify('  Casa  ')).toBe('casa')
    expect(slugify('!!! Lazer !!!')).toBe('lazer')
  })

  it('devolve vazio quando nao sobra nada utilizavel', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('   ')).toBe('')
  })
})
