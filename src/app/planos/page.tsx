import Link from 'next/link'
import { listPlans, checkinPlan } from '@/lib/plans/queries'
import { listMonths } from '@/lib/queries'
import { formatBRL, formatMonth } from '@/lib/month-summary'
import { ThemeToggle } from '@/components/theme-toggle'
import { PlanBuilder } from '@/components/plan-builder'
import { PlanCard } from '@/components/plan-card'
import type { PlanCheckin } from '@/lib/plans/track'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function PlanosPage() {
  const [plans, months] = await Promise.all([listPlans(), listMonths()])
  const currentMonth = months.at(-1) ?? new Date().toISOString().slice(0, 7)

  // O check-in de cada plano ativo: e onde o sistema cobra.
  const checkins = new Map<string, PlanCheckin>()
  for (const p of plans) {
    if (p.status !== 'active') continue
    const c = await checkinPlan(p.id, currentMonth)
    if (c) checkins.set(p.id, c)
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href="/" className={styles.logo} aria-label="Voltar ao dashboard">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className={styles.title}>Planos de ação</h1>
            <p className={styles.subtitle}>acompanhando {formatMonth(currentMonth)}</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className={styles.main}>
        <PlanBuilder />

        {plans.length === 0 ? (
          <p className={styles.empty}>
            Nenhum plano ainda. Diga quanto quer economizar e eu proponho os cortes,
            ranqueados por economia sobre dor.
          </p>
        ) : (
          <section className={styles.list} aria-label="Planos">
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} checkin={checkins.get(p.id) ?? null} />
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
