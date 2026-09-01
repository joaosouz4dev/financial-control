/**
 * Traduz uma edicao em eventos legiveis.
 *
 * Puro de proposito: o que conta como mudanca, e como ela se le em portugues,
 * e a parte que merece teste. Gravar no banco e detalhe de quem chama.
 *
 * Registra so o que mudou de fato. Salvar o editor sem alterar nada nao deve
 * sujar o historico com "valor: R$ 92,00 -> R$ 92,00": um historico cheio de
 * ruido e um historico que ninguem le.
 */

export type EventKind =
  | 'created'
  | 'paid'
  | 'unpaid'
  | 'amount'
  | 'description'
  | 'due_date'
  | 'category'

export interface TxEvent {
  kind: EventKind
  fromValue: string | null
  toValue: string | null
}

export interface TxSnapshot {
  description: string
  amountCents: number
  dueDate: string
  categoryName: string | null
  paidAt: Date | null
}

/** R$ 1.234,56 — mesmo formato da tabela, para o historico nao parecer outro app. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** 05/09/2026 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function diffTransaction(before: TxSnapshot, after: TxSnapshot): TxEvent[] {
  const events: TxEvent[] = []

  const wasPaid = before.paidAt !== null
  const isPaid = after.paidAt !== null
  if (wasPaid !== isPaid) {
    events.push({
      kind: isPaid ? 'paid' : 'unpaid',
      fromValue: wasPaid ? 'pago' : 'a pagar',
      toValue: isPaid ? 'pago' : 'a pagar',
    })
  }

  if (before.amountCents !== after.amountCents) {
    events.push({
      kind: 'amount',
      fromValue: formatCents(before.amountCents),
      toValue: formatCents(after.amountCents),
    })
  }

  if (before.description !== after.description) {
    events.push({
      kind: 'description',
      fromValue: before.description,
      toValue: after.description,
    })
  }

  if (before.dueDate !== after.dueDate) {
    events.push({
      kind: 'due_date',
      fromValue: formatDate(before.dueDate),
      toValue: formatDate(after.dueDate),
    })
  }

  if (before.categoryName !== after.categoryName) {
    events.push({
      kind: 'category',
      fromValue: before.categoryName ?? 'sem categoria',
      toValue: after.categoryName ?? 'sem categoria',
    })
  }

  return events
}

/** A frase que aparece na linha do historico. */
export function describeEvent(e: { kind: string; fromValue: string | null; toValue: string | null }): string {
  switch (e.kind) {
    case 'created':
      return 'Lançamento criado'
    case 'paid':
      return 'Marcado como pago'
    case 'unpaid':
      return 'Desmarcado: voltou para a pagar'
    case 'amount':
      return `Valor: ${e.fromValue} para ${e.toValue}`
    case 'description':
      return `Nome: "${e.fromValue}" para "${e.toValue}"`
    case 'due_date':
      return `Vencimento: ${e.fromValue} para ${e.toValue}`
    case 'category':
      return `Categoria: ${e.fromValue} para ${e.toValue}`
    default:
      return 'Alteração'
  }
}
