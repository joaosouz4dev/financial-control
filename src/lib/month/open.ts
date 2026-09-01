import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { db } from '@/db'
import { contexts, transactionEvents, transactions } from '@/db/schema'

/**
 * Abre o mes copiando o mes anterior, sem os pagamentos.
 *
 * Era exatamente o gesto do Joao na planilha: duplicar a aba do mes passado e
 * limpar a coluna de pago. Nada de inventar linha nova.
 *
 * A primeira versao disto puxava das regras de recorrencia, e encheu setembro
 * de coisa que ele nao paga mais: 30 das 65 regras ativas nao tinham lancamento
 * nenhum em agosto. Sao 4 anos de planilha importada, com conta que trocou de
 * nome ("Mensalidade Zaya" virou "Escola Zaya"), duplicata de importacao
 * ("Marmita e Faxina" #2, #3 e #4) e divida ja quitada. A regra continua
 * "ativa" no banco porque nunca ninguem a desativou.
 *
 * O mes anterior nao tem esse problema: ele e o retrato do que esta valendo
 * agora. Se a conta apareceu mes passado, ela e real.
 */

export interface OpenMonthResult {
  month: string
  created: number
  /** De onde as linhas vieram: qual mes foi copiado. */
  copiedFrom: string | null
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Move o dia para o mes destino, respeitando o tamanho dele.
 *
 * Dia 31 em fevereiro nao existe: cai no ultimo dia. Sem isso a data viraria
 * marco e o lancamento sumiria do mes que acabou de abrir.
 */
export function shiftDay(dueDate: string, targetMonth: string): string {
  const dia = Number(dueDate.slice(8, 10))
  const [y, m] = targetMonth.split('-').map(Number) as [number, number]
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${targetMonth}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`
}

export async function openMonth(
  month: string,
  contextSlug = 'pessoal',
): Promise<OpenMonthResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Mes invalido: "${month}"`)

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) throw new Error(`Contexto "${contextSlug}" nao encontrado`)

  const { from, to } = monthBounds(month)

  /* Ja tem lancamento proprio? Entao o mes ja foi aberto, ou o Joao comecou a
   * preencher na mao. Abrir de novo so duplicaria o que ele ja fez. */
  const [existente] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.contextId, ctx.id),
        gte(transactions.dueDate, from),
        lte(transactions.dueDate, to),
      ),
    )

  if ((existente?.n ?? 0) > 0) return { month, created: 0, copiedFrom: null }

  const anterior = previousMonth(month)
  const ant = monthBounds(anterior)

  const modelo = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.contextId, ctx.id),
        gte(transactions.dueDate, ant.from),
        lte(transactions.dueDate, ant.to),
      ),
    )

  if (modelo.length === 0) return { month, created: 0, copiedFrom: null }

  const novos = modelo.map((t) => ({
    contextId: ctx.id,
    kind: t.kind,
    amountCents: t.amountCents,
    amountExpression: t.amountExpression,
    amountInputs: t.amountInputs,
    description: t.description,
    categoryId: t.categoryId,
    accountId: t.accountId,
    dueDate: shiftDay(t.dueDate, month),
    /* O ponto todo: copia a linha, nao o pagamento. */
    paidAt: null,
    ruleId: t.ruleId,
    /* `occurrenceId` NAO e copiado: aquela ocorrencia pertence ao mes passado.
     * Herda-la faria duas transacoes apontarem para a mesma previsao. */
    source: 'recurrence' as const,
  }))

  const criados = await db.insert(transactions).values(novos).returning({ id: transactions.id })

  // Abre o historico de cada linha nova, senao a trilha comeca no meio.
  if (criados.length > 0) {
    await db.insert(transactionEvents).values(
      criados.map((c) => ({
        transactionId: c.id,
        kind: 'created',
        fromValue: null,
        toValue: `copiado de ${anterior}`,
      })),
    )
  }

  return { month, created: criados.length, copiedFrom: anterior }
}
