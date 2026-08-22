import { createHash } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  transactions,
  recurrenceRules,
  recurrenceOccurrences,
  categories,
  contexts,
  imports,
  importedTransactions,
} from '@/db/schema'
import { parseWorkbook, type ParsedEntry, type ParsedSheet } from './xlsx'
import { deservesRecurrence } from '../classify'
import { selectStaleRules } from '../recurrence/retire'

/**
 * Persiste uma planilha no banco.
 *
 * Idempotente: reimportar o mesmo arquivo nao duplica nada. A chave e o
 * dedupHash por lancamento (arquivo + linha + descricao + valor), gravado com
 * unique index, entao a corretude e garantida pelo banco e nao pela aplicacao.
 */

export interface ImportResult {
  filename: string
  period: string
  inserted: number
  skipped: number
  rulesCreated: number
  /** Regras que pararam de acontecer e foram encerradas neste import. */
  rulesRetired: number
  warnings: number
}

/** Dia da planilha para ISO, clampando meses curtos (dia 30 em fevereiro). */
export function dayToISO(year: number, month: number, day: number | null): string | null {
  if (day === null || day < 1) return null
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const d = Math.min(Math.round(day), last)
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Identidade estavel do lancamento. Inclui a linha porque a planilha tem
 * descricoes repetidas de proposito ("Cartão João Caixa" aparece duas vezes
 * com valores diferentes) e as duas sao lancamentos legitimos.
 */
export function dedupHash(filename: string, e: ParsedEntry): string {
  return createHash('sha256')
    .update([filename, e.row, e.kind, e.description, e.amountCents].join('|'))
    .digest('hex')
}

/**
 * A descricao com parcela muda todo mes ("Marmore 4/6" -> "5/6"), entao o
 * label da regra precisa ser estavel entre os meses.
 *
 * Mas o nome sozinho nao identifica a serie: o Joao tem DUAS obras de marmore
 * simultaneas, uma de 6 parcelas (R$ 369) e outra de 5 (R$ 304). Colapsar as
 * duas em "Marmore" junta series distintas e faz o lag() inventar variacao de
 * preco que nunca existiu. O total de parcelas e o que separa as series.
 */
export function stableLabel(description: string, installmentTotal?: number | null): string {
  const base = description.replace(/\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/, '').trim()
  if (!base) return description
  return installmentTotal ? `${base} (${installmentTotal}x)` : base
}

/**
 * Desambigua lancamentos com o mesmo nome DENTRO do mesmo mes.
 *
 * O Joao tem dois "Cartão João Caixa", ambos dia 14, com valores diferentes
 * (375,08 e 1.808,60) que se repetem identicos todo mes. Nome nao distingue,
 * dia nao distingue, e a linha da planilha desloca quando ele insere algo.
 *
 * O que distingue e que os dois coexistem no MESMO mes: o primeiro
 * "Cartão João Caixa" de junho e o mesmo primeiro de julho. Entao a ordem de
 * aparicao dentro do mes e a identidade.
 *
 * Casar por valor resolveria o cartao e quebraria a Netflix: 44,90 em junho e
 * 59,90 em julho viraria duas regras, e o detector de variacao de preco
 * perderia a serie que precisa comparar.
 */
export function disambiguate(label: string, ordinal: number): string {
  return ordinal === 0 ? label : `${label} #${ordinal + 1}`
}

export async function importWorkbook(filePath: string, filename: string): Promise<ImportResult> {
  const parsed = await parseWorkbook(filePath, filename)
  if (!parsed.period) {
    throw new Error(`${filename}: nao consegui identificar o periodo pelo nome do arquivo`)
  }
  const { year, month } = parsed.period
  const periodLabel = `${String(month).padStart(2, '0')}/${year}`

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctx) throw new Error('Contexto "pessoal" nao encontrado. Rode o seed primeiro.')

  const catRows = await db.select().from(categories)
  const catBySlug = new Map(catRows.map((c) => [c.slug, c]))

  const [imp] = await db
    .insert(imports)
    .values({
      filename,
      kind: 'xlsx',
      periodLabel,
      stats: parsed.stats as Record<string, unknown>,
    })
    .returning()

  let inserted = 0
  let skipped = 0
  let rulesCreated = 0

  // Ordem de aparicao dentro do mes: e o que separa os dois "Cartão João
  // Caixa" sem quebrar a serie da Netflix.
  const seenLabels = new Map<string, number>()

  for (const e of parsed.entries) {
    const hash = dedupHash(filename, e)

    // O unique index e a barreira real contra duplicata.
    const staged = await db
      .insert(importedTransactions)
      .values({ importId: imp!.id, dedupHash: hash, rawPayload: e as unknown as object })
      .onConflictDoNothing({ target: importedTransactions.dedupHash })
      .returning()

    if (staged.length === 0) {
      skipped++
      continue
    }

    const dueDate = dayToISO(year, month, e.dueDay) ?? `${year}-${String(month).padStart(2, '0')}-01`
    const paidISO = dayToISO(year, month, e.paidDay)
    const catSlug = e.categoryRaw ? slugify(e.categoryRaw) : null
    const cat = catSlug ? catBySlug.get(catSlug) : undefined

    // Recorrencia: cria a regra na primeira vez que o lancamento aparece.
    //
    // TODO lancamento da planilha e recorrente, inclusive cartao: a fatura
    // vence todo mes. Antes isto usava isVolatileByNature e o cartao ficava
    // sem regra, apagando ~R$ 4 mil/mes da projecao de fluxo de caixa.
    // "Entra no detector de preco?" e "merece regra?" sao perguntas distintas.
    const baseLabel = stableLabel(e.description, e.installment?.total)
    const ordinal = seenLabels.get(baseLabel) ?? 0
    seenLabels.set(baseLabel, ordinal + 1)
    const label = disambiguate(baseLabel, ordinal)

    let ruleId: string | null = null

    if (deservesRecurrence(e.description)) {
      // Casa so por label, normalizado. O label ja carrega o ordinal, entao os
      // dois cartoes sao regras distintas ('#2' muda a chave) e a Netflix
      // continua uma serie unica mesmo com o valor mudando de 44,90 para 59,90.
      // A normalizacao existe porque a planilha alterna a caixa da mesma linha
      // ('Aparelho Tauana' e 'aparelho tauana'): comparar cru criava uma
      // segunda regra e dobrava o compromisso na projecao de fluxo de caixa.
      const existing = await db
        .select()
        .from(recurrenceRules)
        .where(
          and(
            eq(recurrenceRules.contextId, ctx.id),
            sql`lower(trim(${recurrenceRules.label})) = lower(trim(${label}))`,
          ),
        )
        .limit(1)

      if (existing[0]) {
        ruleId = existing[0].id
      } else {
        const [rule] = await db
          .insert(recurrenceRules)
          .values({
            contextId: ctx.id,
            kind: e.kind,
            label,
            categoryId: cat?.id ?? null,
            amountCents: e.amountCents,
            amountExpression: e.amountExpression,
            cadence: 'monthly',
            dayOfMonth: e.dueDay ? Math.round(e.dueDay) : null,
            installmentCurrent: e.installment?.current ?? null,
            installmentTotal: e.installment?.total ?? null,
            installmentAnchor: e.installment ? dueDate : null,
            startsOn: dueDate,
            active: true,
          })
          .returning()
        ruleId = rule!.id
        rulesCreated++
      }
    }

    const [tx] = await db
      .insert(transactions)
      .values({
        contextId: ctx.id,
        kind: e.kind,
        amountCents: e.amountCents,
        amountExpression: e.amountExpression,
        description: e.description,
        categoryId: cat?.id ?? null,
        dueDate,
        paidAt: paidISO ? new Date(`${paidISO}T12:00:00-03:00`) : null,
        ruleId,
        source: 'import',
      })
      .returning()

    await db
      .update(importedTransactions)
      .set({ matchedTransactionId: tx!.id })
      .where(eq(importedTransactions.id, staged[0]!.id))

    inserted++
  }

  // O import cria regra com folga (quase tudo merece uma), entao ele tambem
  // precisa fechar a conta: sem isso, todo lancamento avulso vira previsao
  // eterna e o mes futuro enche de coisa que aconteceu uma vez, anos atras.
  const rulesRetired = await retireStaleRules(ctx.id, periodEndISO(periodLabel))

  return {
    filename,
    period: periodLabel,
    inserted,
    skipped,
    rulesCreated,
    rulesRetired,
    warnings: parsed.warnings.length,
  }
}

/** Ultimo dia do periodo importado: o "hoje" da decisao de encerramento. */
function periodEndISO(periodLabel: string): string {
  const [m, y] = periodLabel.split('/').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${last}`
}

/**
 * Encerra regras que pararam de aparecer e limpa as previsoes que elas ja
 * tinham gerado adiante. Nao apaga regra nem transacao: ends_on preserva o
 * historico e deixa a regra pronta caso o lancamento volte.
 */
async function retireStaleRules(contextId: string, today: string): Promise<number> {
  const rows = await db
    .select({
      id: recurrenceRules.id,
      startsOn: recurrenceRules.startsOn,
      lastSeen: sql<string | null>`(
        select max(t.due_date)::text from ${transactions} t where t.rule_id = ${recurrenceRules.id}
      )`,
    })
    .from(recurrenceRules)
    .where(and(eq(recurrenceRules.contextId, contextId), isNull(recurrenceRules.endsOn)))

  const stale = selectStaleRules(rows, today)

  for (const r of stale) {
    await db
      .update(recurrenceRules)
      .set({ endsOn: r.endsOn, active: false })
      .where(eq(recurrenceRules.id, r.id))

    await db
      .delete(recurrenceOccurrences)
      .where(
        and(
          eq(recurrenceOccurrences.ruleId, r.id),
          sql`${recurrenceOccurrences.dueDate} > ${r.endsOn}`,
          isNull(recurrenceOccurrences.transactionId),
          isNull(recurrenceOccurrences.skippedAt),
        ),
      )
  }

  return stale.length
}
