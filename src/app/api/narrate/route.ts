import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, gte, lte } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { contexts, transactions } from '@/db/schema'
import { getMonthTransactions, getGoals, getPriceSeries, monthRange } from '@/lib/queries'
import { summarizeMonth } from '@/lib/month-summary'
import { getFlowItems, getOpeningBalance } from '@/lib/cashflow/queries'
import { projectCashflow } from '@/lib/cashflow/project'
import { buildInsights } from '@/lib/insights/build'
import { narrateInsights } from '@/lib/insights/narrate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * O resumo narrado, fora do caminho de render.
 *
 * Antes a narracao rodava dentro da pagina do mes: cada apagar, marcar pago ou
 * editar disparava `router.refresh()`, que re-renderizava a pagina, que
 * chamava a LLM de novo e segurava a tela ate a resposta chegar. Uma exclusao
 * esperava por um texto que nem mudou.
 *
 * Agora a pagina aparece na hora e o resumo chega depois, por aqui.
 */
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const month = new URL(req.url).searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Mês inválido' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ summary: null })

  const [txs, goals, series] = await Promise.all([
    getMonthTransactions(month),
    getGoals(month),
    getPriceSeries(),
  ])

  const summary = summarizeMonth(month, txs, goals)
  const insights = buildInsights(month, summary, txs, series)
  if (insights.length === 0) return NextResponse.json({ summary: null })

  const { from, to } = monthRange(month)
  const [flowItems, opening] = await Promise.all([
    getFlowItems(from, to),
    getOpeningBalance(from),
  ])
  const projection = projectCashflow(flowItems, opening, from, to)

  try {
    const r = await narrateInsights({
      month,
      insights,
      cashflow: {
        closingBalanceCents: projection.closingBalanceCents,
        firstNegativeDate: projection.firstNegative?.date ?? null,
        firstNegativeCents: projection.firstNegative?.balanceCents ?? null,
        troughDate: projection.trough?.date ?? null,
        troughCents: projection.trough?.balanceCents ?? null,
      },
    })
    return NextResponse.json({
      summary: r.summary,
      insightTitles: insights.map((i) => [i.fingerprint, i.title]),
    })
  } catch (e) {
    // O conselho e um extra: os fatos ja estao na tela.
    console.error('narração falhou:', e)
    return NextResponse.json({ summary: null })
  }
}
