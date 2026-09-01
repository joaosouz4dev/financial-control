import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  contexts,
  recurrenceOccurrences,
  recurrenceRules,
  transactions,
} from '@/db/schema'
import { monthBounds, openMonth } from './open'

/**
 * Testa contra o Postgres real: a idempotencia da abertura depende dos indices
 * do banco, entao um mock provaria so que o mock funciona.
 *
 * Usa um mes bem no futuro (2099) para nao encostar nos dados reais do Joao.
 */

const hasDb = !!process.env.DATABASE_URL
const MARKER = 'OPEN_MONTH_TEST'
const MES = '2099-04'

let ctxId: string

async function criarRegra(label: string, dia: number, cents: number) {
  const [r] = await db
    .insert(recurrenceRules)
    .values({
      contextId: ctxId,
      kind: 'expense',
      label: `${label} ${MARKER}`,
      amountCents: cents,
      cadence: 'monthly',
      dayOfMonth: dia,
      startsOn: '2099-01-01',
      active: true,
    })
    .returning()
  return r!
}

async function criarOcorrencia(ruleId: string, dueDate: string, cents: number) {
  const [o] = await db
    .insert(recurrenceOccurrences)
    .values({ ruleId, dueDate, expectedCents: cents })
    .returning()
  return o!
}

async function lancamentosDoMes() {
  const { from, to } = monthBounds(MES)
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

describe.skipIf(!hasDb)('openMonth: abrir o mes novo', () => {
  beforeAll(async () => {
    const [c] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
    ctxId = c!.id
  })

  afterEach(async () => {
    await db.delete(transactions).where(sql`${transactions.description} like ${'%' + MARKER + '%'}`)
    await db.execute(
      sql`delete from recurrence_occurrences where rule_id in (select id from recurrence_rules where label like ${'%' + MARKER + '%'})`,
    )
    await db.delete(recurrenceRules).where(sql`${recurrenceRules.label} like ${'%' + MARKER + '%'}`)
  })

  it('promove a previsao a lancamento a pagar', async () => {
    const regra = await criarRegra('Internet', 5, 9200)
    await criarOcorrencia(regra.id, `${MES}-05`, 9200)

    const r = await openMonth(MES)
    expect(r.created).toBe(1)

    const linhas = await lancamentosDoMes()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.amountCents).toBe(9200)
    // Abre a pagar: e o que o Joao vai marcar durante o mes.
    expect(linhas[0]!.paidAt).toBeNull()
    expect(linhas[0]!.source).toBe('recurrence')
  })

  it('reabrir o mes nao duplica nada', async () => {
    const regra = await criarRegra('Escola', 5, 59000)
    await criarOcorrencia(regra.id, `${MES}-05`, 59000)

    await openMonth(MES)
    // Sem materializar: reabrir nao precisa reempurrar o horizonte.
    const segunda = await openMonth(MES, 'pessoal', { materialize: false })

    expect(segunda.created).toBe(0)
    expect(await lancamentosDoMes()).toHaveLength(1)
  })

  it('nao recria o que ja veio do import ou foi lancado na mao', async () => {
    const regra = await criarRegra('Aluguel', 10, 75000)
    const occ = await criarOcorrencia(regra.id, `${MES}-10`, 75000)

    // Simula a despesa que ja existe: a ocorrencia aponta para ela.
    const [existente] = await db
      .insert(transactions)
      .values({
        contextId: ctxId,
        kind: 'expense',
        amountCents: 75000,
        description: `Aluguel ja lancado ${MARKER}`,
        dueDate: `${MES}-10`,
        ruleId: regra.id,
        source: 'import',
      })
      .returning()
    await db
      .update(recurrenceOccurrences)
      .set({ transactionId: existente!.id })
      .where(eq(recurrenceOccurrences.id, occ.id))

    const r = await openMonth(MES)

    expect(r.created).toBe(0)
    // Uma linha so: a que ja existia. Sem dupla contagem.
    expect(await lancamentosDoMes()).toHaveLength(1)
  })

  it('respeita a ocorrencia pulada', async () => {
    const regra = await criarRegra('Cancelado', 8, 2000)
    const occ = await criarOcorrencia(regra.id, `${MES}-08`, 2000)
    await db
      .update(recurrenceOccurrences)
      .set({ skippedAt: new Date() })
      .where(eq(recurrenceOccurrences.id, occ.id))

    const r = await openMonth(MES)

    expect(r.created).toBe(0)
    expect(await lancamentosDoMes()).toHaveLength(0)
  })

  it('ignora regra inativa', async () => {
    const regra = await criarRegra('Assinatura morta', 8, 1990)
    await criarOcorrencia(regra.id, `${MES}-08`, 1990)
    await db.update(recurrenceRules).set({ active: false }).where(eq(recurrenceRules.id, regra.id))

    const r = await openMonth(MES)

    expect(r.created).toBe(0)
  })

  it('numera a parcela na descricao, como na planilha', async () => {
    const [regra] = await db
      .insert(recurrenceRules)
      .values({
        contextId: ctxId,
        kind: 'expense',
        label: `Parcela Carro ${MARKER}`,
        amountCents: 150000,
        cadence: 'monthly',
        dayOfMonth: 12,
        startsOn: '2099-01-01',
        installmentCurrent: 6,
        installmentTotal: 25,
        installmentAnchor: '2099-01-12',
        active: true,
      })
      .returning()

    await db
      .insert(recurrenceOccurrences)
      .values({
        ruleId: regra!.id,
        dueDate: `${MES}-12`,
        expectedCents: 150000,
        installmentNo: 9,
      })

    await openMonth(MES)

    const linhas = await lancamentosDoMes()
    expect(linhas[0]!.description).toContain('09/25')
  })

  it('mes invalido e erro, nao um mes vazio silencioso', async () => {
    await expect(openMonth('2099-4')).rejects.toThrow(/invalido/i)
  })
})

describe('monthBounds', () => {
  it('acha o ultimo dia certo, inclusive em fevereiro bissexto', () => {
    expect(monthBounds('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
})
