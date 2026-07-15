import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, cardStatements, transactions, contexts } from '@/db/schema'

/**
 * Itemizacao de fatura.
 *
 * A promessa do schema, finalmente cumprida: o cartao vira CONTA, a compra
 * dentro dele vira a despesa (que bate na categoria), e pagar a fatura vira
 * TRANSFERENCIA (que nao bate em categoria nenhuma).
 *
 * Sem isso, o mercado conta duas vezes: uma em Alimentacao e outra dentro do
 * "Cartão João Caixa R$ 1.808,60". A regra `kind <> 'transfer'` nos agregados
 * e o que impede a dupla contagem, e ela so funciona se a fatura for mesmo
 * marcada como transferencia.
 */

export interface ItemizeInput {
  /** A transacao que hoje representa a fatura inteira. */
  statementTxId: string
  /** As compras que compoem a fatura. */
  items: Array<{
    description: string
    amountCents: number
    date: string
    categorySlug: string | null
  }>
}

export interface ItemizeResult {
  accountId: string
  statementId: string
  itemsCreated: number
  transferCents: number
  /** A diferenca entre a fatura e a soma dos itens. */
  unitemizedCents: number
}

export class ItemizeError extends Error {}

/**
 * Converte uma despesa-fatura em conta + itens + transferencia.
 *
 * A soma dos itens raramente bate exatamente com a fatura: sobra o que ele nao
 * itemizou. Em vez de esconder, isso vira um item explicito "nao itemizado",
 * para que a soma sempre feche e ele veja o quanto ainda esta no escuro.
 */
export async function itemizeStatement(
  input: ItemizeInput,
  contextSlug = 'pessoal',
): Promise<ItemizeResult> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) throw new ItemizeError('Contexto não encontrado')

  const [tx] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, input.statementTxId), eq(transactions.contextId, ctx.id)))
    .limit(1)

  if (!tx) throw new ItemizeError('Lançamento não encontrado')
  if (tx.kind !== 'expense') throw new ItemizeError('Só faz sentido itemizar uma despesa')

  const itemsTotal = input.items.reduce((s, i) => s + i.amountCents, 0)
  if (itemsTotal > tx.amountCents) {
    throw new ItemizeError(
      `A soma dos itens (${itemsTotal}) passa o valor da fatura (${tx.amountCents})`,
    )
  }

  // O cartao vira conta. Reusa se ja existir: itemizar duas vezes o mesmo
  // cartao nao pode criar duas contas.
  const existing = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.contextId, ctx.id),
        eq(accounts.name, tx.description),
        eq(accounts.kind, 'credit_card'),
      ),
    )
    .limit(1)

  const account =
    existing[0] ??
    (
      await db
        .insert(accounts)
        .values({
          contextId: ctx.id,
          name: tx.description,
          kind: 'credit_card',
          statementDueDay: Number(tx.dueDate.slice(8, 10)),
        })
        .returning()
    )[0]!

  // Ciclo da fatura: fecha no vencimento, abre um mes antes.
  const periodEnd = tx.dueDate
  const periodStart = shiftMonth(tx.dueDate, -1)

  const [statement] = await db
    .insert(cardStatements)
    .values({
      accountId: account.id,
      periodStart,
      periodEnd,
      dueDate: tx.dueDate,
      closedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [cardStatements.accountId, cardStatements.periodEnd],
      set: { closedAt: new Date() },
    })
    .returning()

  const catRows = await db.query.categories.findMany()
  const catBySlug = new Map(catRows.map((c) => [c.slug, c]))

  // As compras: ESTAS sao as despesas que batem na categoria.
  for (const item of input.items) {
    await db.insert(transactions).values({
      contextId: ctx.id,
      kind: 'expense',
      amountCents: item.amountCents,
      description: item.description,
      categoryId: item.categorySlug ? (catBySlug.get(item.categorySlug)?.id ?? null) : null,
      accountId: account.id,
      statementId: statement!.id,
      dueDate: item.date,
      paidAt: tx.paidAt,
      source: 'manual',
    })
  }

  // O que sobrou: explicito, para a soma fechar e ele ver o escuro.
  const unitemized = tx.amountCents - itemsTotal
  if (unitemized > 0) {
    await db.insert(transactions).values({
      contextId: ctx.id,
      kind: 'expense',
      amountCents: unitemized,
      description: `${tx.description}: não itemizado`,
      accountId: account.id,
      statementId: statement!.id,
      dueDate: tx.dueDate,
      paidAt: tx.paidAt,
      source: 'manual',
    })
  }

  // A fatura vira TRANSFERENCIA. Aqui mora a regra anti-dupla-contagem: como
  // transferencia, ela some dos totais de categoria, e as compras acima e que
  // passam a contar.
  await db
    .update(transactions)
    .set({
      kind: 'transfer',
      counterpartyAccountId: account.id,
      statementId: statement!.id,
      description: `Pagamento ${tx.description}`,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, tx.id))

  return {
    accountId: account.id,
    statementId: statement!.id,
    itemsCreated: input.items.length + (unitemized > 0 ? 1 : 0),
    transferCents: tx.amountCents,
    unitemizedCents: unitemized,
  }
}

function shiftMonth(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}
