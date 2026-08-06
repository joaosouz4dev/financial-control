import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, categories, contexts } from '@/db/schema'
import { resolveColors } from './categories/palette'

/**
 * A tabela de lancamentos: o que a planilha mostrava e o dashboard tinha
 * escondido atras de resumos. Cada despesa e receita em linha, com dia, valor,
 * categoria e status pago/a pagar.
 */

export interface LedgerRow {
  id: string
  kind: 'expense' | 'income' | 'transfer'
  amountCents: number
  description: string
  categorySlug: string | null
  categoryName: string | null
  /** Par (claro, escuro) ja resolvido: a tabela nao precisa saber de paleta. */
  categoryColor: { light: string; dark: string } | null
  dueDay: number
  /** YYYY-MM-DD completo: o toggle de pago precisa da data, nao so do dia. */
  dueDate: string
  paidDay: number | null
  paid: boolean
}

export interface Ledger {
  expenses: LedgerRow[]
  incomes: LedgerRow[]
  totalExpenseCents: number
  totalIncomeCents: number
  paidExpenseCents: number
}

export async function getLedger(month: string, contextSlug = 'pessoal'): Promise<Ledger> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) return { expenses: [], incomes: [], totalExpenseCents: 0, totalIncomeCents: 0, paidExpenseCents: 0 }

  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const from = `${month}-01`
  const to = `${month}-${String(last).padStart(2, '0')}`

  const rows = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amountCents: transactions.amountCents,
      description: transactions.description,
      categorySlug: categories.slug,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryColorDark: categories.colorDark,
      dueDate: transactions.dueDate,
      paidAt: transactions.paidAt,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.contextId, ctx.id),
        gte(transactions.dueDate, from),
        lte(transactions.dueDate, to),
      ),
    )
    .orderBy(asc(transactions.dueDate))

  const mapped: LedgerRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amountCents: r.amountCents,
    description: r.description,
    categorySlug: r.categorySlug ?? null,
    categoryName: r.categoryName ?? null,
    categoryColor: r.categoryName ? resolveColors(r.categoryColor, r.categoryColorDark) : null,
    dueDay: Number(r.dueDate.slice(8, 10)),
    dueDate: r.dueDate,
    paidDay: r.paidAt ? r.paidAt.getUTCDate() : null,
    paid: r.paidAt !== null,
  }))

  // Transferencia (pagamento de fatura) nao e nem despesa nem receita na
  // tabela: mostra como despesa mas sem contar no total, para nao dupla-contar.
  const expenses = mapped.filter((r) => r.kind === 'expense')
  const incomes = mapped.filter((r) => r.kind === 'income')

  return {
    expenses,
    incomes,
    totalExpenseCents: expenses.reduce((s, r) => s + r.amountCents, 0),
    totalIncomeCents: incomes.reduce((s, r) => s + r.amountCents, 0),
    paidExpenseCents: expenses.filter((r) => r.paid).reduce((s, r) => s + r.amountCents, 0),
  }
}
