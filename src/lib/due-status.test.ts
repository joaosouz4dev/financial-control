import { describe, expect, it } from 'vitest'
import { addDays, dueStatus } from './due-status'

const TODAY = '2026-08-15'

function status(dueDate: string, paid = false, today = TODAY) {
  return dueStatus({ paid, dueDate }, today)
}

describe('dueStatus', () => {
  it('pago vence qualquer outro estado, mesmo atrasado', () => {
    expect(status('2026-08-01', true)).toBe('paid')
    expect(status('2026-12-31', true)).toBe('paid')
  })

  it('marca atraso so antes de hoje', () => {
    expect(status('2026-08-14')).toBe('overdue')
    expect(status('2026-08-15')).not.toBe('overdue')
  })

  it('a janela do amarelo e hoje ate hoje+3, inclusive nas pontas', () => {
    expect(status('2026-08-15')).toBe('due-soon')
    expect(status('2026-08-18')).toBe('due-soon')
    expect(status('2026-08-19')).toBe('open')
  })

  it('a janela atravessa a virada do mes', () => {
    // Onde a formula da planilha quebrava: DAY(30)+3 = 33 nao existe, entao
    // dia 1 do mes seguinte nunca ficava amarelo.
    expect(status('2026-09-01', false, '2026-08-30')).toBe('due-soon')
    expect(status('2026-09-02', false, '2026-08-30')).toBe('due-soon')
    expect(status('2026-09-03', false, '2026-08-31')).toBe('due-soon')
    expect(status('2026-09-04', false, '2026-08-31')).toBe('open')
  })

  it('atravessa a virada do ano', () => {
    expect(status('2027-01-01', false, '2026-12-30')).toBe('due-soon')
    expect(status('2026-12-31', false, '2027-01-02')).toBe('overdue')
  })

  it('nao inventa estado em meses que nao sao o atual', () => {
    // Mes passado inteiro em aberto: tudo atrasado, nada amarelo.
    expect(status('2026-07-10')).toBe('overdue')
    // Mes futuro: nada atrasado, nada amarelo.
    expect(status('2026-10-10')).toBe('open')
  })
})

describe('addDays', () => {
  it('atravessa mes, ano e ano bissexto', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-27', 3)).toBe('2028-03-01')
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
  })
})
