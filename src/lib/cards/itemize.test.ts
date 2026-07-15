import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, contexts, accounts, cardStatements, categories } from '@/db/schema'
import { itemizeStatement, ItemizeError } from './itemize'

/**
 * Testa contra o Postgres real: a regra anti-dupla-contagem so vale se o banco
 * a respeitar. Cada teste cria seu proprio dado e limpa depois.
 */

const hasDb = !!process.env.DATABASE_URL

let ctxId: string
let catAlim: string

const MARKER = 'ITEMIZE_TEST'

async function totals(from = '2099-01-01', to = '2099-12-31') {
  const [r] = await db
    .select({
      expense: sql<string>`coalesce(sum(case when ${transactions.kind}='expense' then ${transactions.amountCents} else 0 end),0)`,
      alim: sql<string>`coalesce(sum(case when ${transactions.kind}='expense' and ${transactions.categoryId}=${catAlim} then ${transactions.amountCents} else 0 end),0)`,
      transfer: sql<string>`coalesce(sum(case when ${transactions.kind}='transfer' then ${transactions.amountCents} else 0 end),0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.contextId, ctxId), sql`${transactions.dueDate} between ${from} and ${to}`))
  return {
    expense: Number(r!.expense),
    alim: Number(r!.alim),
    transfer: Number(r!.transfer),
  }
}

describe.skipIf(!hasDb)('itemizeStatement: a regra anti-dupla-contagem', () => {
  beforeAll(async () => {
    const [c] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
    ctxId = c!.id
    const [a] = await db.select().from(categories).where(eq(categories.slug, 'alimentacao')).limit(1)
    catAlim = a!.id
  })

  afterEach(async () => {
    // Limpa so o que o teste criou: nao toca nos dados reais.
    await db.delete(transactions).where(sql`${transactions.description} like ${'%' + MARKER + '%'}`)
    await db.delete(cardStatements).where(
      sql`${cardStatements.accountId} in (select id from accounts where name like ${'%' + MARKER + '%'})`,
    )
    await db.delete(accounts).where(sql`${accounts.name} like ${'%' + MARKER + '%'}`)
  })

  async function criarFatura(amountCents = 180860) {
    const [tx] = await db
      .insert(transactions)
      .values({
        contextId: ctxId,
        kind: 'expense',
        amountCents,
        description: `Cartão ${MARKER}`,
        dueDate: '2099-07-14',
        paidAt: new Date('2099-07-14T12:00:00-03:00'),
        source: 'manual',
      })
      .returning()
    return tx!
  }

  /**
   * O teste que justifica a feature inteira: a fatura de R$ 1.808,60 tem
   * R$ 900 de mercado dentro. Sem itemizar, esse mercado nao aparece em
   * Alimentacao. Itemizando, ele aparece E o total nao muda.
   */
  it('itemizar não muda a despesa total: a fatura vira transferência', async () => {
    const fatura = await criarFatura(180860)
    const antes = await totals()

    await itemizeStatement({
      statementTxId: fatura.id,
      items: [
        { description: `Mercado ${MARKER}`, amountCents: 90000, date: '2099-07-08', categorySlug: 'alimentacao' },
        { description: `Posto ${MARKER}`, amountCents: 40000, date: '2099-07-10', categorySlug: 'transporte' },
      ],
    })

    const depois = await totals()
    expect(depois.expense).toBe(antes.expense)
    expect(depois.transfer).toBe(180860)
  })

  it('o gasto escondido aparece na categoria certa', async () => {
    const fatura = await criarFatura(180860)
    const antes = await totals()

    await itemizeStatement({
      statementTxId: fatura.id,
      items: [
        { description: `Mercado ${MARKER}`, amountCents: 90000, date: '2099-07-08', categorySlug: 'alimentacao' },
      ],
    })

    const depois = await totals()
    expect(depois.alim - antes.alim).toBe(90000)
  })

  it('o que sobra vira item explícito, não some', async () => {
    const fatura = await criarFatura(180860)

    const r = await itemizeStatement({
      statementTxId: fatura.id,
      items: [
        { description: `Mercado ${MARKER}`, amountCents: 90000, date: '2099-07-08', categorySlug: 'alimentacao' },
      ],
    })

    expect(r.unitemizedCents).toBe(90860)
    expect(r.itemsCreated).toBe(2) // o item + o não itemizado

    const rows = await db
      .select()
      .from(transactions)
      .where(sql`${transactions.description} like ${'%não itemizado%'} and ${transactions.description} like ${'%' + MARKER + '%'}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amountCents).toBe(90860)
  })

  it('a soma dos itens fecha com a fatura', async () => {
    const fatura = await criarFatura(100000)
    await itemizeStatement({
      statementTxId: fatura.id,
      items: [{ description: `X ${MARKER}`, amountCents: 100000, date: '2099-07-08', categorySlug: null }],
    })

    const items = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.kind, 'expense'), sql`${transactions.description} like ${'%' + MARKER + '%'}`))
    expect(items.reduce((s, i) => s + i.amountCents, 0)).toBe(100000)
  })

  it('recusa itens que passam do valor da fatura', async () => {
    const fatura = await criarFatura(10000)
    await expect(
      itemizeStatement({
        statementTxId: fatura.id,
        items: [{ description: `X ${MARKER}`, amountCents: 20000, date: '2099-07-08', categorySlug: null }],
      }),
    ).rejects.toThrow(ItemizeError)
  })

  it('reusa a conta: itemizar duas vezes não cria dois cartões', async () => {
    const f1 = await criarFatura(50000)
    await itemizeStatement({
      statementTxId: f1.id,
      items: [{ description: `A ${MARKER}`, amountCents: 50000, date: '2099-07-08', categorySlug: null }],
    })

    const f2 = await db
      .insert(transactions)
      .values({
        contextId: ctxId,
        kind: 'expense',
        amountCents: 60000,
        description: `Cartão ${MARKER}`,
        dueDate: '2099-08-14',
        source: 'manual',
      })
      .returning()

    await itemizeStatement({
      statementTxId: f2[0]!.id,
      items: [{ description: `B ${MARKER}`, amountCents: 60000, date: '2099-08-08', categorySlug: null }],
    })

    const accs = await db.select().from(accounts).where(sql`${accounts.name} like ${'%' + MARKER + '%'}`)
    expect(accs).toHaveLength(1)
  })

  it('recusa itemizar o que não é despesa', async () => {
    const [receita] = await db
      .insert(transactions)
      .values({
        contextId: ctxId,
        kind: 'income',
        amountCents: 50000,
        description: `Receita ${MARKER}`,
        dueDate: '2099-07-14',
        source: 'manual',
      })
      .returning()

    await expect(
      itemizeStatement({ statementTxId: receita!.id, items: [] }),
    ).rejects.toThrow(/despesa/)
  })
})
