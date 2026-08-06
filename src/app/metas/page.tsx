import { getGoals } from '@/lib/queries'
import { AppHeader } from '@/components/app-header'
import { GoalsEditor } from '@/components/goals-editor'
import styles from '../historico/page.module.css'

export const dynamic = 'force-dynamic'

export default async function MetasPage() {
  const month = new Date().toISOString().slice(0, 7)
  const goals = await getGoals(month, 'pessoal', { includeInvestment: true })

  return (
    <div className={styles.shell}>
      <AppHeader title="Metas" subtitle="quanto da receita cada categoria pode usar" />

      <main className={styles.main}>
        <GoalsEditor
          initial={goals.map((g) => ({
            categorySlug: g.categorySlug,
            categoryName: g.categoryName,
            pct: g.pct,
          }))}
        />
      </main>
    </div>
  )
}
