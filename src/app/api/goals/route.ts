import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { goals, categories, contexts } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Metas por categoria (% da receita), como o bloco OBJETIVO da planilha.
 *
 * As metas sao VERSIONADAS por effectiveFrom: mudar a meta hoje nao reescreve
 * o passado. Um mes historico continua sendo avaliado contra a meta que valia
 * naquele mes, que e o comportamento certo para nao falsear o historico.
 */

const PutSchema = z.object({
  /** A partir de quando vale. Default: primeiro dia do mes atual. */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  goals: z
    .array(
      z.object({
        categorySlug: z.string().min(1),
        pct: z.number().min(0).max(100),
      }),
    )
    .min(1),
})

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctx) return NextResponse.json({ error: 'Contexto não encontrado' }, { status: 500 })

  const rows = await db
    .select({
      categorySlug: categories.slug,
      categoryName: categories.name,
      pct: goals.pctOfIncome,
      effectiveFrom: goals.effectiveFrom,
    })
    .from(goals)
    .innerJoin(categories, eq(categories.id, goals.categoryId))
    .where(eq(goals.contextId, ctx.id))
    .orderBy(desc(goals.effectiveFrom))

  // Uma meta por categoria: a mais recente em vigor.
  const seen = new Set<string>()
  const current = rows.filter((r) => {
    if (seen.has(r.categorySlug)) return false
    seen.add(r.categorySlug)
    return true
  })

  return NextResponse.json({
    goals: current.map((g) => ({
      categorySlug: g.categorySlug,
      categoryName: g.categoryName,
      pct: Number(g.pct),
      effectiveFrom: g.effectiveFrom,
    })),
  })
}

export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let parsed
  try {
    parsed = PutSchema.safeParse(await req.json())
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

  const catRows = await db.select().from(categories)
  const catBySlug = new Map(catRows.map((c) => [c.slug, c]))

  const effectiveFrom =
    parsed.data.effectiveFrom ?? `${new Date().toISOString().slice(0, 7)}-01`

  for (const g of parsed.data.goals) {
    const cat = catBySlug.get(g.categorySlug)
    if (!cat) {
      return NextResponse.json(
        { error: `Categoria desconhecida: ${g.categorySlug}` },
        { status: 400 },
      )
    }

    await db
      .insert(goals)
      .values({
        contextId: ctx.id,
        categoryId: cat.id,
        pctOfIncome: String(g.pct),
        effectiveFrom,
      })
      .onConflictDoUpdate({
        target: [goals.contextId, goals.categoryId, goals.effectiveFrom],
        set: { pctOfIncome: String(g.pct) },
      })
  }

  const total = parsed.data.goals.reduce((s, g) => s + g.pct, 0)

  return NextResponse.json({
    ok: true,
    effectiveFrom,
    totalPct: Number(total.toFixed(2)),
    // Nao bloqueia se passar de 100: e decisao dele, so avisa.
    warning: total > 100 ? `As metas somam ${total.toFixed(0)}% da receita.` : null,
  })
}
