import { NextResponse } from 'next/server'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import { recurrenceRules, transactions, contexts, categories } from '@/db/schema'
import { extractTransactions, ExtractionError } from '@/lib/nl/extract'
import { resolveTransaction, ResolveError, TZ } from '@/lib/nl/resolve'
import { decideMatch, type Candidate } from '@/lib/nl/match'

dayjs.extend(utc)
dayjs.extend(timezone)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Extrai transacoes do texto e devolve uma PREVIA para confirmacao.
 *
 * Esta rota nao grava nada. A LLM propoe, o codigo resolve e casa, e o usuario
 * confirma. Gravar direto da extracao seria confiar num texto gerado.
 */
export async function POST(req: Request) {
  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const text = body.text?.trim()
  if (!text) {
    return NextResponse.json({ error: 'Escreva o que você quer lançar.' }, { status: 400 })
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: 'Texto longo demais (máximo 2000 caracteres).' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY não configurada. Preencha o .env.local.' },
      { status: 503 },
    )
  }

  const now = dayjs().tz(TZ)
  const today = now.format('YYYY-MM-DD')

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctx) return NextResponse.json({ error: 'Contexto não encontrado. Rode o seed.' }, { status: 500 })

  // Vocabulario dele: vai depois do breakpoint de cache.
  const rules = await db
    .select({
      id: recurrenceRules.id,
      label: recurrenceRules.label,
      amountCents: recurrenceRules.amountCents,
      dayOfMonth: recurrenceRules.dayOfMonth,
      categorySlug: categories.slug,
    })
    .from(recurrenceRules)
    .leftJoin(categories, eq(categories.id, recurrenceRules.categoryId))
    .where(and(eq(recurrenceRules.contextId, ctx.id), eq(recurrenceRules.active, true)))

  try {
    const result = await extractTransactions(text, {
      today,
      knownLabels: rules.map((r) => r.label),
    })

    // Candidatos a casamento: o que ainda esta em aberto neste mes.
    const monthStart = now.startOf('month').format('YYYY-MM-DD')
    const monthEnd = now.endOf('month').format('YYYY-MM-DD')

    const open = await db
      .select({
        id: transactions.id,
        ruleId: transactions.ruleId,
        description: transactions.description,
        amountCents: transactions.amountCents,
        dueDate: transactions.dueDate,
        categorySlug: categories.slug,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.contextId, ctx.id),
          isNull(transactions.paidAt),
          gte(transactions.dueDate, monthStart),
          lte(transactions.dueDate, monthEnd),
        ),
      )

    const candidates: Candidate[] = open.map((t) => ({
      ruleId: t.id,
      label: t.description,
      expectedCents: t.amountCents,
      dueDate: t.dueDate,
      categorySlug: t.categorySlug ?? null,
    }))

    const previews = result.extraction.transactions.map((t) => {
      try {
        const r = resolveTransaction(t, now)
        const decision = decideMatch(r.labelHint, r.amountCents, r.date, candidates)
        return {
          ok: true as const,
          resolved: r,
          match: decision.matched
            ? {
                transactionId: decision.matched.candidate.ruleId,
                label: decision.matched.candidate.label,
                expectedCents: decision.matched.candidate.expectedCents,
                score: Number(decision.matched.score.toFixed(2)),
                reasons: decision.matched.reasons,
              }
            : null,
          alternatives: decision.alternatives.map((a) => ({
            transactionId: a.candidate.ruleId,
            label: a.candidate.label,
            expectedCents: a.candidate.expectedCents,
            score: Number(a.score.toFixed(2)),
          })),
          isNew: decision.isNew,
        }
      } catch (e) {
        if (e instanceof ResolveError) {
          return { ok: false as const, error: e.message, raw: t }
        }
        throw e
      }
    })

    return NextResponse.json({
      previews,
      usage: result.usage,
      latencyMs: result.latencyMs,
    })
  } catch (e) {
    if (e instanceof ExtractionError) {
      return NextResponse.json({ error: `Não consegui entender: ${e.message}` }, { status: 422 })
    }
    const msg = e instanceof Error ? e.message : 'erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
