'use client'

import { useEffect, useState } from 'react'

/**
 * As categorias vivas, vindas do banco.
 *
 * Antes os dois formularios carregavam a mesma lista fixa no codigo, entao uma
 * categoria criada em /categorias nunca aparecia na hora de lancar.
 */

export interface CategoryOption {
  slug: string
  name: string
}

let cache: CategoryOption[] | null = null

export function useCategories(): CategoryOption[] {
  const [items, setItems] = useState<CategoryOption[]>(cache ?? [])

  useEffect(() => {
    let alive = true
    fetch('/api/categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.categories) return
        const next = d.categories.map((c: { slug: string; name: string }) => ({
          slug: c.slug,
          name: c.name,
        }))
        cache = next
        setItems(next)
      })
      .catch(() => {
        // Falhou: o select fica com o que ja tinha. Melhor uma lista velha do
        // que um formulario sem categoria nenhuma.
      })
    return () => {
      alive = false
    }
  }, [])

  return items
}
