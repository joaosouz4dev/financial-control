import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { contexts, recurrenceOccurrences, recurrenceRules, transactions } from '@/db/schema'
import { getFlowItems } from './queries'

/**
 * A regra anti-dupla-contagem no fluxo de caixa.
 *
 * Setembro somou R$ 23.350,80 a mais porque cada conta aparecia duas vezes: o
 * lancamento copiado do mes anterior e a previsao da regra, que tinha ficado
 * solta. O grafico mostrava dinheiro que nao existia.
 */

const hasDb = !!process.env.DATABASE_URL
const MARKER = 'FLOW_DUP_TEST'
const FROM = '2095-05-01'
const TO = '2095-05-31'

let ctxId: string

describe.skipIf(!hasDb)('getFlowItems: previsto nao concorre com lancado', () => {
  beforeAll(async () => {
    const [c] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
    ctxId = c!.id
  })

  afterEach(async () => {
    await db.execute(
      sql`delete from recurrence_occurrences where rule_id in (select id from recurrence_rules where label like ${'%' + MARKER + '%'})`,
    )
    await db.delete(transactions).where(sql`${transactions.description} like ${'%' + MARKER + '%'}`)
    await db.delete(recurrenceRules).where(sql`${recurrenceRules.label} like ${'%' + MARKER + '%'}`)
  })

  async function criarRegra(cents: number) {
    const [r] = await db
      .insert(recurrenceRules)
      .values({
        contextId: ctxId,
        kind: 'income',
        label: `Vansa ${MARKER}`,
        amountCents: cents,
        cadence: 'monthly',
        dayOfMonth: 29,
        startsOn: '2095-01-01',
        active: true,
      })
      .returning()
    return r!
  }

  it('ignora a previsao solta quando a regra ja tem lancamento no periodo', async () => {
    const regra = await criarRegra(500000)

    // Previsao SEM transaction_id: exatamente o estado que causou o bug.
    await db.insert(recurrenceOccurrences).values({
      ruleId: regra.id,
      dueDate: '2095-05-29',
      expectedCents: 500000,
    })

    await db.insert(transactions).values({
      contextId: ctxId,
      kind: 'income',
      amountCents: 900000,
      description: `Vansa ${MARKER}`,
      dueDate: '2095-05-29',
      ruleId: regra.id,
      source: 'recurrence',
    })

    const itens = (await getFlowItems(FROM, TO)).filter((i) => i.label.includes(MARKER))

    // Um item so, e o valor lancado: o real ganha do previsto.
    expect(itens).toHaveLength(1)
    expect(itens[0]!.amountCents).toBe(900000)
  })

  it('mantem a previsao quando nao ha lancamento daquela regra', async () => {
    const regra = await criarRegra(500000)
    await db.insert(recurrenceOccurrences).values({
      ruleId: regra.id,
      dueDate: '2095-05-29',
      expectedCents: 500000,
    })

    const itens = (await getFlowItems(FROM, TO)).filter((i) => i.label.includes(MARKER))

    // Sem lancamento, a previsao e a unica informacao que existe: tem que ficar.
    expect(itens).toHaveLength(1)
    expect(itens[0]!.amountCents).toBe(500000)
    expect(itens[0]!.settled).toBe(false)
  })
})
