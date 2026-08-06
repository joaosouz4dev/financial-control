import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { categories, transactions } from '@/db/schema'
import { slotByKey } from '@/lib/categories/palette'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PatchSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  colorKey: z.string().max(20).optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await ctx.params

  let parsed
  try {
    parsed = PatchSchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const [cat] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  const patch: { name?: string; color?: string; colorDark?: string | null } = {}

  if (parsed.data.name !== undefined) {
    const name = parsed.data.name.trim()
    if (!name) return NextResponse.json({ error: 'O nome não pode ficar vazio.' }, { status: 400 })

    const [clash] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, name), ne(categories.id, id), isNull(categories.archivedAt)))
      .limit(1)
    if (clash) return NextResponse.json({ error: `Já existe uma categoria "${name}".` }, { status: 409 })

    // O slug nao muda junto: ele e a chave que o importador e as regras usam
    // para reencontrar a categoria. Renomear e so a etiqueta.
    patch.name = name
  }

  if (parsed.data.colorKey !== undefined) {
    patch.color = slotByKey(parsed.data.colorKey).key
    patch.colorDark = null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada para alterar.' }, { status: 400 })
  }

  const [updated] = await db.update(categories).set(patch).where(eq(categories.id, id)).returning()
  return NextResponse.json({ id: updated!.id, name: updated!.name })
}

/**
 * Arquiva a categoria em vez de apagar.
 *
 * Apagar exigiria decidir o que fazer com os lancamentos antigos, e qualquer
 * escolha ai reescreve historico: ou eles perdem a categoria, ou somem. Arquivar
 * tira a categoria das listas novas e preserva o que ja foi lancado.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await ctx.params

  const [cat] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  const [tally] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.categoryId, id))

  await db.update(categories).set({ archivedAt: new Date() }).where(eq(categories.id, id))

  return NextResponse.json({ archived: true, keptTransactions: tally?.count ?? 0 })
}
