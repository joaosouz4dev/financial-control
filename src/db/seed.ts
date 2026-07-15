import { db } from './index'
import { categories, contexts, goals } from './schema'
import { sql } from 'drizzle-orm'

/**
 * Categorias e metas iniciais, espelhando o bloco OBJETIVO da planilha.
 * Idempotente: pode rodar quantas vezes quiser.
 */

export const CATEGORY_SEED = [
  { slug: 'casa', name: 'Casa', color: '#6d28d9' },
  { slug: 'transporte', name: 'Transporte', color: '#0ea5e9' },
  { slug: 'saude', name: 'Saúde', color: '#ec4899' },
  { slug: 'alimentacao', name: 'Alimentação', color: '#f59e0b' },
  { slug: 'lazer', name: 'Lazer', color: '#2dd4bf' },
  { slug: 'investimento', name: 'Investimento', color: '#22c55e' },
  { slug: 'outros', name: 'Outros', color: '#8e88a3' },
]

/** As metas da planilha: somam 100%. */
export const GOAL_SEED: Record<string, number> = {
  casa: 20,
  transporte: 8,
  saude: 10,
  alimentacao: 25,
  lazer: 12,
  investimento: 20,
  outros: 5,
}

export const CONTEXT_SEED = [
  { slug: 'pessoal', name: 'Pessoal', color: '#6d28d9' },
  { slug: 'empresa', name: 'Empresa', color: '#2dd4bf' },
]

export async function seed(effectiveFrom = '2020-01-01') {
  const ctx = await db
    .insert(contexts)
    .values(CONTEXT_SEED)
    .onConflictDoUpdate({ target: contexts.slug, set: { name: sql`excluded.name` } })
    .returning()

  const cats = await db
    .insert(categories)
    .values(CATEGORY_SEED)
    .onConflictDoUpdate({ target: categories.slug, set: { name: sql`excluded.name` } })
    .returning()

  const pessoal = ctx.find((c) => c.slug === 'pessoal')!
  const goalRows = cats
    .filter((c) => GOAL_SEED[c.slug] !== undefined)
    .map((c) => ({
      contextId: pessoal.id,
      categoryId: c.id,
      pctOfIncome: String(GOAL_SEED[c.slug]!),
      effectiveFrom,
    }))

  await db
    .insert(goals)
    .values(goalRows)
    .onConflictDoUpdate({
      target: [goals.contextId, goals.categoryId, goals.effectiveFrom],
      set: { pctOfIncome: sql`excluded.pct_of_income` },
    })

  return { contexts: ctx.length, categories: cats.length, goals: goalRows.length }
}
