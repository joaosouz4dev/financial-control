import { NextResponse } from 'next/server'
import { z } from 'zod'
import { asc, eq, isNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { categories } from '@/db/schema'
import {
  CATEGORY_PALETTE,
  nextFreeSlot,
  resolveColors,
  slotByKey,
  slugify,
} from '@/lib/categories/palette'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const rows = await db
    .select()
    .from(categories)
    .where(isNull(categories.archivedAt))
    .orderBy(asc(categories.sortOrder), asc(categories.name))

  return NextResponse.json({
    categories: rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      colorKey: c.color?.startsWith('#') ? null : c.color,
      colors: resolveColors(c.color, c.colorDark),
    })),
    palette: CATEGORY_PALETTE,
  })
}

const PostSchema = z.object({
  name: z.string().min(1).max(40),
  /** Chave de slot da paleta; ausente escolhe o proximo livre. */
  colorKey: z.string().max(20).nullable().optional(),
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
    return NextResponse.json({ error: 'Escreva o nome da categoria.' }, { status: 400 })
  }

  const name = parsed.data.name.trim()
  const slug = slugify(name)
  if (!slug) {
    return NextResponse.json({ error: 'Esse nome não gera um identificador válido.' }, { status: 400 })
  }

  const [existing] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1)
  if (existing) {
    // Recriar uma arquivada e reativar, nao duplicar: os lancamentos antigos
    // continuam apontando para ela.
    if (existing.archivedAt) {
      const [revived] = await db
        .update(categories)
        .set({ archivedAt: null, name })
        .where(eq(categories.id, existing.id))
        .returning()
      return NextResponse.json({ id: revived!.id, slug: revived!.slug, revived: true })
    }
    return NextResponse.json({ error: `Já existe uma categoria "${existing.name}".` }, { status: 409 })
  }

  const all = await db.select({ color: categories.color }).from(categories)
  const slot = parsed.data.colorKey
    ? slotByKey(parsed.data.colorKey)
    : nextFreeSlot(all.map((c) => c.color))

  const [created] = await db
    .insert(categories)
    .values({
      slug,
      name,
      color: slot.key,
      colorDark: null,
      sortOrder: all.length,
    })
    .returning()

  return NextResponse.json({ id: created!.id, slug: created!.slug, name: created!.name })
}
