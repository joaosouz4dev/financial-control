/**
 * Resumo do mes: os numeros do bloco RESUMO GERAL da planilha, mais o que
 * ela nao calcula.
 *
 * Regra anti-dupla-contagem: transferencia (pagar fatura de cartao) NUNCA
 * entra em total de despesa nem de categoria. A despesa e a compra.
 */

export type Kind = 'expense' | 'income' | 'transfer'

export interface Tx {
  id: string
  kind: Kind
  amountCents: number
  description: string
  categorySlug: string | null
  categoryName: string | null
  dueDate: string
  paidAt: string | null
  contextSlug: string
}

export interface Goal {
  categorySlug: string
  categoryName: string
  pct: number
}

export interface CategoryLine {
  slug: string
  name: string
  spentCents: number
  goalCents: number | null
  goalPct: number | null
  /** > 100 = estourou. */
  usagePct: number | null
  count: number
}

export interface MonthSummary {
  month: string
  totalExpenseCents: number
  totalIncomeCents: number
  paidCents: number
  toPayCents: number
  receivedCents: number
  toReceiveCents: number
  /** Receita recebida menos despesa paga: o dinheiro que existe agora. */
  currentBalanceCents: number
  /** Receita total menos despesa total: onde o mes termina. */
  projectedBalanceCents: number
  investmentTargetCents: number
  categories: CategoryLine[]
  expenseCount: number
  incomeCount: number
}

/** Transferencia nao e despesa: e dinheiro trocando de bolso. */
const isLedger = (t: Tx) => t.kind !== 'transfer'

export function summarizeMonth(
  month: string,
  txs: Tx[],
  goals: Goal[],
  investmentPct = 20,
): MonthSummary {
  const ledger = txs.filter(isLedger)
  const expenses = ledger.filter((t) => t.kind === 'expense')
  const incomes = ledger.filter((t) => t.kind === 'income')

  const sum = (arr: Tx[]) => arr.reduce((s, t) => s + t.amountCents, 0)

  const totalExpenseCents = sum(expenses)
  const totalIncomeCents = sum(incomes)
  const paidCents = sum(expenses.filter((t) => t.paidAt !== null))
  const receivedCents = sum(incomes.filter((t) => t.paidAt !== null))

  const goalBySlug = new Map(goals.map((g) => [g.categorySlug, g]))
  const byCategory = new Map<string, { name: string; cents: number; count: number }>()

  for (const t of expenses) {
    const slug = t.categorySlug ?? 'sem-categoria'
    const name = t.categoryName ?? 'Sem categoria'
    const cur = byCategory.get(slug) ?? { name, cents: 0, count: 0 }
    cur.cents += t.amountCents
    cur.count += 1
    byCategory.set(slug, cur)
  }

  // Categorias com meta aparecem mesmo sem gasto: meta zerada e informacao.
  for (const g of goals) {
    if (!byCategory.has(g.categorySlug)) {
      byCategory.set(g.categorySlug, { name: g.categoryName, cents: 0, count: 0 })
    }
  }

  const categories: CategoryLine[] = [...byCategory.entries()]
    .map(([slug, v]) => {
      const goal = goalBySlug.get(slug)
      const goalCents = goal ? Math.round((totalIncomeCents * goal.pct) / 100) : null
      return {
        slug,
        name: v.name,
        spentCents: v.cents,
        goalCents,
        goalPct: goal?.pct ?? null,
        usagePct: goalCents && goalCents > 0 ? (v.cents / goalCents) * 100 : null,
        count: v.count,
      }
    })
    .sort((a, b) => b.spentCents - a.spentCents)

  return {
    month,
    totalExpenseCents,
    totalIncomeCents,
    paidCents,
    toPayCents: totalExpenseCents - paidCents,
    receivedCents,
    toReceiveCents: totalIncomeCents - receivedCents,
    currentBalanceCents: receivedCents - paidCents,
    projectedBalanceCents: totalIncomeCents - totalExpenseCents,
    investmentTargetCents: Math.round((totalIncomeCents * investmentPct) / 100),
    categories,
    expenseCount: expenses.length,
    incomeCount: incomes.length,
  }
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-')
  const names = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ]
  return `${names[Number(m) - 1]} de ${y}`
}
