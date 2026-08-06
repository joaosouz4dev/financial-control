import Link from 'next/link'
import { getGoals } from '@/lib/queries'
import { ThemeToggle } from '@/components/theme-toggle'
import { GoalsEditor } from '@/components/goals-editor'
import styles from '../historico/page.module.css'

export const dynamic = 'force-dynamic'

export default async function MetasPage() {
  const month = new Date().toISOString().slice(0, 7)
  const goals = await getGoals(month, 'pessoal', { includeInvestment: true })

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href="/" className={styles.back} aria-label="Voltar ao dashboard">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className={styles.title}>Metas</h1>
            <p className={styles.subtitle}>quanto da receita cada categoria pode usar</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

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
