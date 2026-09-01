import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { contexts, transactionEvents, transactions } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** O historico de um lancamento, do mais recente para o mais antigo. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  }

  const [ctxRow] = await db.select().from(contexts).where(eq(contexts.slug, 'pessoal')).limit(1)
  if (!ctxRow) return NextResponse.json({ error: 'Contexto não encontrado' }, { status: 500 })

  /* Confere que o lancamento e deste contexto antes de devolver o historico:
   * senao o id na URL viraria uma janela para dado de outro contexto. */
  const [tx] = await db
    .select({ id: transactions.id, createdAt: transactions.createdAt })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.contextId, ctxRow.id)))
    .limit(1)

  if (!tx) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })

  const rows = await db
    .select()
    .from(transactionEvents)
    .where(eq(transactionEvents.transactionId, id))
    .orderBy(desc(transactionEvents.createdAt))
    .limit(50)

  return NextResponse.json({
    events: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      fromValue: r.fromValue,
      toValue: r.toValue,
      createdAt: r.createdAt,
    })),
    /* Lancamento que veio do backfill nao tem evento nenhum. A tela usa isso
     * para dizer "importado da planilha" em vez de "sem historico". */
    transactionCreatedAt: tx.createdAt,
  })
}
