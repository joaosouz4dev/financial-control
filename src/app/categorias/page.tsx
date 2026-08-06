import { asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { categories, transactions } from '@/db/schema'
import { CATEGORY_PALETTE, resolveColors } from '@/lib/categories/palette'
import { AppHeader } from '@/components/app-header'
import { CategoriesManager } from '@/components/categories-manager'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function CategoriasPage() {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      color: categories.color,
      colorDark: categories.colorDark,
      transactionCount: sql<number>`count(${transactions.id})::int`,
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(isNull(categories.archivedAt))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name))

  const items = rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    colorKey: c.color?.startsWith('#') ? null : c.color,
    colors: resolveColors(c.color, c.colorDark),
    transactionCount: c.transactionCount ?? 0,
  }))

  return (
    <main className={styles.page}>
      <AppHeader title="Categorias" subtitle="crie, renomeie e escolha a cor" />
      <div className={styles.body}>
        <CategoriesManager initial={items} palette={CATEGORY_PALETTE} />
      </div>
    </main>
  )
}
