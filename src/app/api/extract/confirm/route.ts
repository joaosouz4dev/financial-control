import { NextResponse } from 'next/server'
import { z } from 'zod'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { transactions, recurrenceRules, contexts, categories, extractions, aliases } from '@/db/schema'
import { TZ } from '@/lib/nl/resolve'
import { sql } from 'drizzle-orm'

dayjs.extend(utc)
dayjs.extend(timezone)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Grava o que o usuario confirmou.
 *
 * A extracao propos; aqui e o codigo que persiste, com valores que vieram
 * validados. Nada nesta rota vem de texto gerado sem passar por schema.
 */

const ConfirmSchema = z.object({
  rawText: z.string().min(1).max(2000),
  items: z
    .array(
      z.object({
        kind: z.enum(['income', 'expense']),
        intent: z.enum(['record', 'price_change', 'new_recurring', 'cancel']),
        amountCents: z.number().int().positive(),
        amountExpression: z.string().nullable(),
        labelHint: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        /** Preenchido = baixa este previsto. Vazio = lançamento novo. */
        matchedTransactionId: z.string().uuid().nullable(),
        categorySlug: z.string().nullable(),
      }),
    )
    .min(1),
})

export async function POST(req: Request) {
  let parsed
  try {
    parsed = ConfirmSchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Dados inválidos: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    )
  }

  const { rawText, items } = parsed.data
  const now = dayjs().tz(TZ)

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctx) return NextResponse.json({ error: 'Contexto não encontrado' }, { status: 500 })

  const catRows = await db.select().from(categories)
  const catBySlug = new Map(catRows.map((c) => [c.slug, c]))

  const applied: Array<{ action: string; label: string; id: string }> = []

  for (const item of items) {
    const cat = item.categorySlug ? catBySlug.get(item.categorySlug) : undefined

    // "netflix subiu pra 59,90": atualiza a REGRA, nao lanca gasto. Sem isso o
    // detector de variacao de preco nunca dispararia.
    if (item.intent === 'price_change') {
      const [rule] = await db
        .select()
        .from(recurrenceRules)
        .where(
          and(
            eq(recurrenceRules.contextId, ctx.id),
            sql`lower(${recurrenceRules.label}) like ${'%' + item.labelHint.toLowerCase() + '%'}`,
          ),
        )
        .limit(1)

      if (rule) {
        await db
          .update(recurrenceRules)
          .set({ amountCents: item.amountCents, amountExpression: item.amountExpression })
          .where(eq(recurrenceRules.id, rule.id))
        applied.push({ action: 'preço atualizado', label: rule.label, id: rule.id })
        continue
      }
      return NextResponse.json(
        { error: `Não achei uma recorrência chamada "${item.labelHint}".` },
        { status: 404 },
      )
    }

    if (item.intent === 'cancel') {
      const [rule] = await db
        .select()
        .from(recurrenceRules)
        .where(
          and(
            eq(recurrenceRules.contextId, ctx.id),
            sql`lower(${recurrenceRules.label}) like ${'%' + item.labelHint.toLowerCase() + '%'}`,
          ),
        )
        .limit(1)

      if (rule) {
        await db
          .update(recurrenceRules)
          .set({ active: false, endsOn: item.date })
          .where(eq(recurrenceRules.id, rule.id))
        applied.push({ action: 'cancelada', label: rule.label, id: rule.id })
        continue
      }
      return NextResponse.json(
        { error: `Não achei uma recorrência chamada "${item.labelHint}".` },
        { status: 404 },
      )
    }

    // Casou com previsto: baixa, nao duplica.
    if (item.matchedTransactionId) {
      const [updated] = await db
        .update(transactions)
        .set({
          paidAt: new Date(`${item.date}T12:00:00-03:00`),
          amountCents: item.amountCents,
          rawText,
          source: 'nl',
          updatedAt: new Date(),
        })
        .where(
          and(eq(transactions.id, item.matchedTransactionId), eq(transactions.contextId, ctx.id)),
        )
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Lançamento previsto não encontrado.' }, { status: 404 })
      }
      applied.push({ action: 'pago', label: updated.description, id: updated.id })
      continue
    }

    // Lancamento novo.
    const [created] = await db
      .insert(transactions)
      .values({
        contextId: ctx.id,
        kind: item.kind,
        amountCents: item.amountCents,
        amountExpression: item.amountExpression,
        description: item.labelHint,
        categoryId: cat?.id ?? null,
        dueDate: item.date,
        paidAt: item.intent === 'record' ? new Date(`${item.date}T12:00:00-03:00`) : null,
        source: 'nl',
        rawText,
      })
      .returning()

    applied.push({ action: 'lançado', label: created!.description, id: created!.id })

    // O vocabulario cresce sozinho: isto substitui fine-tuning.
    await db
      .insert(aliases)
      .values({
        surface: item.labelHint.toLowerCase(),
        targetType: 'category',
        targetId: cat?.id ?? created!.id,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [aliases.surface, aliases.targetType],
        set: { hits: sql`${aliases.hits} + 1`, lastUsedAt: new Date() },
      })
  }

  // Rastro: o que ele escreveu e o que virou.
  await db.insert(extractions).values({
    rawText,
    model: 'claude-opus-4-8',
    toolInput: items as unknown as object,
    userAction: 'accepted',
    resolvedTransactionId: applied[0]?.id ?? null,
  })

  return NextResponse.json({ applied })
}
