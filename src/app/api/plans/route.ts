import { NextResponse } from 'next/server'
import { z } from 'zod'
import { proposePlan, createPlan, decideItem } from '@/lib/plans/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ProposeSchema = z.object({
  targetCents: z.number().int().positive().max(100_000_00),
  title: z.string().min(1).max(120).optional(),
  /** Só propõe (preview) ou já grava? */
  save: z.boolean().optional(),
})

/** Propõe cortes para uma meta. Não grava a menos que `save` seja true. */
export async function POST(req: Request) {
  let parsed
  try {
    parsed = ProposeSchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Dados inválidos: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    )
  }

  const { targetCents, title, save } = parsed.data

  try {
    const proposal = await proposePlan(targetCents)

    if (!save) return NextResponse.json({ proposal })

    const planId = await createPlan(
      title ?? `Economizar ${(targetCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês`,
      targetCents,
      proposal,
    )
    return NextResponse.json({ planId, proposal })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

const DecideSchema = z.object({
  itemId: z.string().uuid(),
  accepted: z.boolean(),
})

/** Aceita ou rejeita um item do plano. */
export async function PATCH(req: Request) {
  let parsed
  try {
    parsed = DecideSchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  try {
    await decideItem(parsed.data.itemId, parsed.data.accepted)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
