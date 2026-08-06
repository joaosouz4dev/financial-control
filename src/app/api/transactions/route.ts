import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { transactions, categories, contexts } from '@/db/schema'
import { evaluateToCents, FormulaError } from '@/lib/formula/evaluate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cria um lancamento manualmente, sem passar pelo chat. */
const PostSchema = z.object({
  kind: z.enum(['expense', 'income']),
  description: z.string().min(1).max(200),
  /** Aceita "89,59", "R$ 1.850" ou "=4*550". */
  amount: z.string().min(1).max(60),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categorySlug: z.string().nullable().optional(),
  paid: z.boolean().optional(),
})

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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
      { status: 400 },
    )
  }

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctx) return NextResponse.json({ error: 'Contexto não encontrado' }, { status: 500 })

  const { kind, description, amount, dueDate, categorySlug, paid } = parsed.data

  const raw = amount.replace(/R\$\s*/gi, '').trim()
  let cents: number
  try {
    cents = evaluateToCents(raw)
  } catch (e) {
    if (e instanceof FormulaError) {
      return NextResponse.json({ error: `Valor inválido: "${amount}"` }, { status: 400 })
    }
    throw e
  }
  if (cents <= 0) {
    return NextResponse.json({ error: 'O valor precisa ser maior que zero.' }, { status: 400 })
  }

  let categoryId: string | null = null
  if (categorySlug) {
    const [cat] = await db.select().from(categories).where(eq(categories.slug, categorySlug)).limit(1)
    if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 400 })
    categoryId = cat.id
  }

  const [created] = await db
    .insert(transactions)
    .values({
      contextId: ctx.id,
      kind,
      amountCents: cents,
      // Preserva a formula como intencao, igual ao importador.
      amountExpression: raw.startsWith('=') ? raw : null,
      description: description.trim(),
      categoryId,
      dueDate,
      paidAt: paid ? new Date(`${dueDate}T12:00:00-03:00`) : null,
      source: 'manual',
    })
    .returning()

  return NextResponse.json({ id: created!.id, description: created!.description })
}
