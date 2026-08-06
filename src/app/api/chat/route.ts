import { NextResponse } from 'next/server'
import { z } from 'zod'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { chatMessages, contexts, recurrenceRules, transactions, categories } from '@/db/schema'
import { extractTransactions, ExtractionError } from '@/lib/nl/extract'
import { resolveTransaction, ResolveError, TZ } from '@/lib/nl/resolve'
import { decideMatch, type Candidate } from '@/lib/nl/match'

dayjs.extend(utc)
dayjs.extend(timezone)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Histórico da conversa. */
export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctx) return NextResponse.json({ messages: [] })

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.contextId, ctx.id))
    .orderBy(asc(chatMessages.createdAt))
    .limit(200)

  return NextResponse.json({
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      payload: r.payload,
      createdAt: r.createdAt,
    })),
  })
}

const PostSchema = z.object({ text: z.string().min(1).max(2000) })

/**
 * Recebe a mensagem, extrai as transacoes e devolve a previa para confirmar.
 * Nao grava lancamento: quem grava e /api/extract/confirm.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let parsed
  try {
    parsed = PostSchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Escreva o que você quer lançar.' }, { status: 400 })
  }

  const { text } = parsed.data
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctx) return NextResponse.json({ error: 'Contexto não encontrado' }, { status: 500 })

  // Grava a mensagem do usuario antes de qualquer coisa: se a extracao falhar,
  // a conversa nao perde o que ele escreveu.
  const [userMsg] = await db
    .insert(chatMessages)
    .values({ contextId: ctx.id, role: 'user', content: text })
    .returning()

  if (!process.env.ANTHROPIC_API_KEY) {
    const msg =
      'A chave da Anthropic não está configurada, então não consigo ler o que você escreveu. ' +
      'Configure ANTHROPIC_API_KEY para usar o chat, ou lance pelo botão + na tabela.'
    const [assistant] = await db
      .insert(chatMessages)
      .values({ contextId: ctx.id, role: 'assistant', content: msg })
      .returning()
    return NextResponse.json({ userMessage: userMsg, assistantMessage: assistant, previews: [] })
  }

  const now = dayjs().tz(TZ)

  try {
    const rules = await db
      .select({ label: recurrenceRules.label })
      .from(recurrenceRules)
      .where(and(eq(recurrenceRules.contextId, ctx.id), eq(recurrenceRules.active, true)))

    const result = await extractTransactions(text, {
      today: now.format('YYYY-MM-DD'),
      knownLabels: rules.map((r) => r.label),
    })

    // Candidatos: o que ainda esta em aberto no mes.
    const monthStart = now.startOf('month').format('YYYY-MM-DD')
    const monthEnd = now.endOf('month').format('YYYY-MM-DD')
    const open = await db
      .select({
        id: transactions.id,
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
                reasons: decision.matched.reasons,
              }
            : null,
          alternatives: decision.alternatives.map((a) => ({
            transactionId: a.candidate.ruleId,
            label: a.candidate.label,
            expectedCents: a.candidate.expectedCents,
          })),
          isNew: decision.isNew,
        }
      } catch (e) {
        if (e instanceof ResolveError) return { ok: false as const, error: e.message }
        throw e
      }
    })

    const resumo = describePreviews(previews)
    const [assistant] = await db
      .insert(chatMessages)
      .values({
        contextId: ctx.id,
        role: 'assistant',
        content: resumo,
        payload: { previews } as unknown as Record<string, unknown>,
      })
      .returning()

    return NextResponse.json({ userMessage: userMsg, assistantMessage: assistant, previews })
  } catch (e) {
    const msg =
      e instanceof ExtractionError
        ? `Não consegui entender: ${e.message}`
        : 'Deu erro ao processar. Tente escrever de outro jeito.'
    const [assistant] = await db
      .insert(chatMessages)
      .values({ contextId: ctx.id, role: 'assistant', content: msg })
      .returning()
    return NextResponse.json({ userMessage: userMsg, assistantMessage: assistant, previews: [] })
  }
}

function describePreviews(previews: Array<{ ok: boolean }>): string {
  const ok = previews.filter((p) => p.ok).length
  if (ok === 0) return 'Não achei nenhum lançamento nessa mensagem.'
  if (ok === 1) return 'Achei 1 lançamento. Confere e confirma?'
  return `Achei ${ok} lançamentos. Confere e confirma?`
}
