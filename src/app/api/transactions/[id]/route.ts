import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { transactions, categories, contexts } from '@/db/schema'
import { evaluateToCents, FormulaError } from '@/lib/formula/evaluate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Edita e apaga um lancamento.
 *
 * O valor aceita formula ("=4*550"), do mesmo jeito que a planilha: quem
 * avalia e o codigo, com Decimal, preservando a intencao em amountExpression.
 */

const PatchSchema = z.object({
  description: z.string().min(1).max(200).optional(),
  /** Aceita "89,59", "R$ 1.850" ou "=4*550". */
  amount: z.string().min(1).max(60).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categorySlug: z.string().nullable().optional(),
  /** null = marcar como nao pago. Data = pago naquele dia. */
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  }

  let parsed
  try {
    parsed = PatchSchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Dados inválidos: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    )
  }

  const [ctxRow] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctxRow) return NextResponse.json({ error: 'Contexto não encontrado' }, { status: 500 })

  const patch = parsed.data
  const update: Record<string, unknown> = { updatedAt: new Date() }

  if (patch.description !== undefined) update.description = patch.description.trim()

  if (patch.amount !== undefined) {
    const raw = patch.amount.replace(/R\$\s*/gi, '').trim()
    try {
      const cents = evaluateToCents(raw)
      if (cents <= 0) {
        return NextResponse.json({ error: 'O valor precisa ser maior que zero.' }, { status: 400 })
      }
      update.amountCents = cents
      // Preserva a formula como intencao, igual ao importador.
      update.amountExpression = raw.startsWith('=') ? raw : null
    } catch (e) {
      if (e instanceof FormulaError) {
        return NextResponse.json({ error: `Valor inválido: "${patch.amount}"` }, { status: 400 })
      }
      throw e
    }
  }

  if (patch.dueDate !== undefined) update.dueDate = patch.dueDate

  if (patch.categorySlug !== undefined) {
    if (patch.categorySlug === null) {
      update.categoryId = null
    } else {
      const [cat] = await db
        .select()
        .from(categories)
        .where(eq(categories.slug, patch.categorySlug))
        .limit(1)
      if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 400 })
      update.categoryId = cat.id
    }
  }

  if (patch.paidDate !== undefined) {
    update.paidAt = patch.paidDate ? new Date(`${patch.paidDate}T12:00:00-03:00`) : null
  }

  const [updated] = await db
    .update(transactions)
    .set(update)
    .where(and(eq(transactions.id, id), eq(transactions.contextId, ctxRow.id)))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })

  return NextResponse.json({
    id: updated.id,
    description: updated.description,
    amountCents: updated.amountCents,
    dueDate: updated.dueDate,
    paidAt: updated.paidAt,
  })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  }

  const [ctxRow] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctxRow) return NextResponse.json({ error: 'Contexto não encontrado' }, { status: 500 })

  const [deleted] = await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.contextId, ctxRow.id)))
    .returning({ id: transactions.id })

  if (!deleted) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
