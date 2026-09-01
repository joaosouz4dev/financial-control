import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { contexts, recurrenceOccurrences, recurrenceRules, transactions } from '@/db/schema'
import { monthBounds, openMonth, previousMonth, shiftDay } from './open'

/**
 * Testa contra o Postgres real: a garantia de nao duplicar depende do estado
 * do banco, entao um mock provaria so que o mock funciona.
 *
 * Usa 2097, e nao 2099, porque itemize.test.ts soma o ano de 2099 inteiro para
 * checar a regra anti-dupla-contagem: os dois rodam em paralelo e as linhas
 * daqui entrariam naquela soma.
 */

const hasDb = !!process.env.DATABASE_URL
const MARKER = 'OPEN_MONTH_TEST'
const ANTERIOR = '2097-03'
const MES = '2097-04'

let ctxId: string

async function lancar(
  description: string,
  dueDate: string,
  cents: number,
  paid = false,
) {
  const [t] = await db
    .insert(transactions)
    .values({
      contextId: ctxId,
      kind: 'expense',
      amountCents: cents,
      description: `${description} ${MARKER}`,
      dueDate,
      paidAt: paid ? new Date(`${dueDate}T12:00:00-03:00`) : null,
      source: 'manual',
    })
    .returning()
  return t!
}

async function doMes(month: string) {
  const { from, to } = monthBounds(month)
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.contextId, ctxId),
        sql`${transactions.dueDate} between ${from} and ${to}`,
      ),
    )
}

describe.skipIf(!hasDb)('openMonth: copia o mes anterior sem os pagamentos', () => {
  beforeAll(async () => {
    const [c] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
    ctxId = c!.id
  })

  afterEach(async () => {
    await db.delete(transactions).where(sql`${transactions.description} like ${'%' + MARKER + '%'}`)
  })

  it('copia as linhas do mes anterior', async () => {
    await lancar('Internet', `${ANTERIOR}-05`, 9200, true)
    await lancar('Escola', `${ANTERIOR}-10`, 59000, true)

    const r = await openMonth(MES)

    expect(r.created).toBe(2)
    expect(r.copiedFrom).toBe(ANTERIOR)
    expect(await doMes(MES)).toHaveLength(2)
  })

  it('copia a linha mas nunca o pagamento', async () => {
    await lancar('Internet', `${ANTERIOR}-05`, 9200, true)

    await openMonth(MES)

    const novas = await doMes(MES)
    expect(novas[0]!.paidAt).toBeNull()
    expect(novas[0]!.amountCents).toBe(9200)
  })

  it('nao traz de volta o que sumiu do mes anterior', async () => {
    // O ponto do bug: uma conta cancelada nao aparece no mes passado, entao ela
    // nao deve reaparecer no mes novo, mesmo tendo existido antes.
    await lancar('Ainda pago', `${ANTERIOR}-05`, 5000, true)
    await lancar('Cancelei faz tempo', '2097-01-05', 9900, true)

    await openMonth(MES)

    const novas = await doMes(MES)
    expect(novas).toHaveLength(1)
    expect(novas[0]!.description).toContain('Ainda pago')
  })

  it('nao duplica se o mes ja tem lancamento', async () => {
    await lancar('Internet', `${ANTERIOR}-05`, 9200, true)
    await openMonth(MES)

    const segunda = await openMonth(MES)

    expect(segunda.created).toBe(0)
    expect(await doMes(MES)).toHaveLength(1)
  })

  it('nao mexe no que o Joao ja lancou na mao', async () => {
    await lancar('Internet', `${ANTERIOR}-05`, 9200, true)
    await lancar('Lancei na mao', `${MES}-03`, 4500)

    const r = await openMonth(MES)

    // Mes ja comecado: a abertura nao entra por cima.
    expect(r.created).toBe(0)
    expect(await doMes(MES)).toHaveLength(1)
  })

  it('mes anterior vazio nao gera nada', async () => {
    const r = await openMonth(MES)
    expect(r.created).toBe(0)
    expect(r.copiedFrom).toBeNull()
  })

  it('copia receita junto com despesa', async () => {
    await db.insert(transactions).values({
      contextId: ctxId,
      kind: 'income',
      amountCents: 900000,
      description: `Salario ${MARKER}`,
      dueDate: `${ANTERIOR}-29`,
      paidAt: new Date(`${ANTERIOR}-29T12:00:00-03:00`),
      source: 'manual',
    })

    await openMonth(MES)

    const novas = await doMes(MES)
    expect(novas).toHaveLength(1)
    expect(novas[0]!.kind).toBe('income')
    // Receita tambem abre sem baixa: ainda nao entrou.
    expect(novas[0]!.paidAt).toBeNull()
  })

  it('liga a linha copiada a previsao, para nao contar duas vezes', async () => {
    /* O bug que apareceu em setembro: a linha copiada e a previsao da regra
     * viravam dois itens no fluxo de caixa, somando o mesmo dinheiro em dobro
     * (R$ 23.350,80 no mes inteiro). */
    const [regra] = await db
      .insert(recurrenceRules)
      .values({
        contextId: ctxId,
        kind: 'income',
        label: `Salario ${MARKER}`,
        amountCents: 500000,
        cadence: 'monthly',
        dayOfMonth: 29,
        startsOn: '2097-01-01',
        active: true,
      })
      .returning()

    await db.insert(recurrenceOccurrences).values({
      ruleId: regra!.id,
      dueDate: `${MES}-29`,
      expectedCents: 500000,
    })

    // A linha do mes anterior aponta para a mesma regra.
    await db.insert(transactions).values({
      contextId: ctxId,
      kind: 'income',
      amountCents: 900000,
      description: `Salario ${MARKER}`,
      dueDate: `${ANTERIOR}-29`,
      paidAt: new Date(`${ANTERIOR}-29T12:00:00-03:00`),
      ruleId: regra!.id,
      source: 'manual',
    })

    await openMonth(MES)

    const [occ] = await db
      .select()
      .from(recurrenceOccurrences)
      .where(eq(recurrenceOccurrences.ruleId, regra!.id))

    // A previsao passou a apontar para a linha nova: deixou de estar solta.
    expect(occ!.transactionId).not.toBeNull()

    await db.delete(recurrenceOccurrences).where(eq(recurrenceOccurrences.ruleId, regra!.id))
    await db.delete(transactions).where(eq(transactions.ruleId, regra!.id))
    await db.delete(recurrenceRules).where(eq(recurrenceRules.id, regra!.id))
  })

  it('mes invalido e erro, nao um mes vazio silencioso', async () => {
    await expect(openMonth('2097-4')).rejects.toThrow(/invalido/i)
  })
})

describe('previousMonth', () => {
  it('atravessa a virada do ano', () => {
    expect(previousMonth('2026-09')).toBe('2026-08')
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-03')).toBe('2026-02')
  })
})

describe('shiftDay', () => {
  it('mantem o dia quando ele existe no mes destino', () => {
    expect(shiftDay('2026-08-05', '2026-09')).toBe('2026-09-05')
    expect(shiftDay('2026-08-30', '2026-09')).toBe('2026-09-30')
  })

  it('cai no ultimo dia quando o dia nao existe no destino', () => {
    // 31 de janeiro nao vira 31 de fevereiro: viraria marco e sumiria do mes.
    expect(shiftDay('2026-01-31', '2026-02')).toBe('2026-02-28')
    expect(shiftDay('2028-01-31', '2028-02')).toBe('2028-02-29')
    expect(shiftDay('2026-08-31', '2026-09')).toBe('2026-09-30')
  })
})

describe('monthBounds', () => {
  it('acha o ultimo dia certo, inclusive em fevereiro bissexto', () => {
    expect(monthBounds('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})
