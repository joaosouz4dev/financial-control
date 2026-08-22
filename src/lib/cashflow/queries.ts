import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  recurrenceOccurrences,
  recurrenceRules,
  transactions,
  contexts,
} from '@/db/schema'
import type { FlowItem } from './project'

/**
 * Monta os itens de fluxo de caixa: o que ja aconteceu (transacoes) mais o que
 * esta previsto (ocorrencias sem transacao ligada).
 *
 * A regra anti-dupla-contagem vale aqui tambem: transferencia nao entra, e
 * ocorrencia que ja virou transacao nao e contada de novo.
 */
export async function getFlowItems(
  from: string,
  to: string,
  contextSlug = 'pessoal',
): Promise<FlowItem[]> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) return []

  // Realizado e previsto que ja tem lancamento.
  const txs = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amountCents: transactions.amountCents,
      description: transactions.description,
      dueDate: transactions.dueDate,
      paidAt: transactions.paidAt,
      ruleId: transactions.ruleId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.contextId, ctx.id),
        gte(transactions.dueDate, from),
        lte(transactions.dueDate, to),
        // Transferencia e dinheiro trocando de bolso: nao muda o saldo total.
        sql`${transactions.kind} <> 'transfer'`,
      ),
    )

  const fromTx: FlowItem[] = txs.map((t) => ({
    date: t.dueDate,
    label: t.description,
    amountCents: t.amountCents,
    direction: t.kind === 'income' ? 'in' : 'out',
    settled: t.paidAt !== null,
    ruleId: t.ruleId,
  }))

  // Previsto puro: ocorrencia futura que ainda nao virou lancamento.
  const occ = await db
    .select({
      dueDate: recurrenceOccurrences.dueDate,
      expectedCents: recurrenceOccurrences.expectedCents,
      installmentNo: recurrenceOccurrences.installmentNo,
      label: recurrenceRules.label,
      kind: recurrenceRules.kind,
      ruleId: recurrenceRules.id,
      installmentTotal: recurrenceRules.installmentTotal,
      dayOfMonth: recurrenceRules.dayOfMonth,
    })
    .from(recurrenceOccurrences)
    .innerJoin(recurrenceRules, eq(recurrenceRules.id, recurrenceOccurrences.ruleId))
    .where(
      and(
        eq(recurrenceRules.contextId, ctx.id),
        gte(recurrenceOccurrences.dueDate, from),
        lte(recurrenceOccurrences.dueDate, to),
        isNull(recurrenceOccurrences.transactionId),
        isNull(recurrenceOccurrences.skippedAt),
        sql`${recurrenceRules.kind} <> 'transfer'`,
      ),
    )

  const fromOcc: FlowItem[] = occ.map((o) => ({
    date: o.dueDate,
    label:
      o.installmentNo && o.installmentTotal
        ? `${o.label} ${o.installmentNo}/${o.installmentTotal}`
        : o.label,
    amountCents: o.expectedCents,
    direction: o.kind === 'income' ? 'in' : 'out',
    settled: false,
    ruleId: o.ruleId,
    // Sem dia de vencimento na regra, o gerador cai no dia do starts_on. Marca
    // para a UI poder dizer que a data e inferida em vez de afirmar um dia.
    dateInferred: o.dayOfMonth === null,
  }))

  return [...fromTx, ...fromOcc].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Saldo de abertura do mes.
 *
 * DELIBERADAMENTE zero enquanto nao houver conta bancaria plugada.
 *
 * A tentacao e somar os meses anteriores: junho fecha em +R$ 4.999,31, entao
 * julho comecaria com isso. Matematicamente coerente e conceitualmente falso.
 * A planilha nunca carregou saldo entre meses: cada arquivo comeca do zero, e
 * o dinheiro que sobrou em junho foi investido, gasto ou ficou na conta, e o
 * sistema nao sabe qual. Carregar o saldo fingiria uma continuidade de conta
 * corrente que nao existe, e o numero na tela seria confiavelmente errado.
 *
 * Cada mes e projetado do zero, igual a planilha. Quando houver OFX/extrato,
 * esta funcao passa a ler o saldo real da conta.
 */
export async function getOpeningBalance(_before: string, _contextSlug = 'pessoal'): Promise<number> {
  return 0
}

/**
 * O saldo que a planilha chama de "Saldo Atual": recebido menos pago DENTRO do
 * mes. Nao e saldo bancario, e o realizado do periodo.
 */
export async function getRealizedBalance(
  from: string,
  to: string,
  contextSlug = 'pessoal',
): Promise<number> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) return 0

  const [row] = await db
    .select({
      balance: sql<string>`coalesce(sum(
        case when ${transactions.kind} = 'income' then ${transactions.amountCents}
             when ${transactions.kind} = 'expense' then -${transactions.amountCents}
             else 0 end
      ), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.contextId, ctx.id),
        sql`${transactions.paidAt} is not null`,
        gte(transactions.dueDate, from),
        lte(transactions.dueDate, to),
      ),
    )

  return Number(row?.balance ?? 0)
}
