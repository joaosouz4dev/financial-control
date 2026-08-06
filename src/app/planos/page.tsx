import { listPlans, checkinPlan } from '@/lib/plans/queries'
import { listMonths } from '@/lib/queries'
import { formatBRL, formatMonth } from '@/lib/month-summary'
import { AppHeader } from '@/components/app-header'
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
      <AppHeader title="Planos de ação" subtitle={`acompanhando ${formatMonth(currentMonth)}`} />

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
