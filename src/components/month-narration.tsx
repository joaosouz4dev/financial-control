'use client'

import { useEffect, useState } from 'react'
import type { Summary } from '@/lib/insights/narrate'
import { MonthSummaryCard } from './month-summary-card'

/**
 * O resumo narrado, buscado depois que a pagina ja apareceu.
 *
 * Antes ele era gerado dentro do render do servidor, entao toda mudanca na
 * tabela (apagar, marcar pago, editar) chamava `router.refresh()`, que chamava
 * a LLM de novo e segurava a tela ate a resposta voltar. Apagar um item
 * esperava por um texto que nem tinha mudado.
 *
 * Nao renderiza nada enquanto carrega: e um extra sobre fatos que ja estao na
 * tela, entao um esqueleto piscando aqui atrapalharia mais do que ajuda.
 */
export function MonthNarration({ month }: { month: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [titles, setTitles] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let vivo = true
    setSummary(null)

    fetch(`/api/narrate?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo || !d?.summary) return
        setSummary(d.summary)
        setTitles(new Map(d.insightTitles ?? []))
      })
      .catch(() => {
        // O conselho e opcional: os fatos ja estao na tela.
      })

    return () => {
      vivo = false
    }
  }, [month])

  if (!summary) return null
  return <MonthSummaryCard summary={summary} insightTitles={titles} />
}
