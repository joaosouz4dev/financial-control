'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/month-summary'
import type { SavedPlan } from '@/lib/plans/queries'
import type { PlanCheckin } from '@/lib/plans/track'
import styles from './plan-card.module.css'

const STATUS_LABEL: Record<string, string> = {
  kept: 'cumprido',
  partial: 'parcial',
  broken: 'furou',
  unknown: 'sem dado',
}

/**
 * O plano com o veredito do mes. Um plano que so propoe e um post-it: o ciclo
 * se fecha aqui, comparando o que ele aceitou com o que de fato gastou.
 */
export function PlanCard({ plan, checkin }: { plan: SavedPlan; checkin: PlanCheckin | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function decide(itemId: string, accepted: boolean) {
    setBusy(itemId)
    try {
      await fetch('/api/plans', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId, accepted }),
      })
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const pending = plan.items.filter((i) => i.accepted === null)
  const accepted = plan.items.filter((i) => i.accepted === true)
  const acceptedSaving = accepted.reduce((s, i) => s + i.savingCents, 0)

  return (
    <article className={styles.card}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>{plan.title}</h3>
          <p className={styles.meta}>
            {accepted.length} de {plan.items.length} aceitos ·{' '}
            <span className="tnum">{formatBRL(acceptedSaving)}</span>/mês
          </p>
        </div>
        <span className={`${styles.status} ${styles[plan.status]}`}>{plan.status}</span>
      </div>

      {/* O veredito: o sistema cobra. */}
      {checkin && (
        <div className={`${styles.checkin} ${checkin.onTrack ? styles.onTrack : styles.offTrack}`}>
          <p className={styles.checkinHead}>
            {checkin.onTrack ? (
              <>
                No trilho: economizou <strong>{formatBRL(checkin.savedCents)}</strong> dos{' '}
                {formatBRL(checkin.promisedCents)} combinados.
              </>
            ) : (
              <>
                Fora do trilho: economizou <strong>{formatBRL(checkin.savedCents)}</strong> dos{' '}
                {formatBRL(checkin.promisedCents)} combinados.
              </>
            )}
          </p>
          <ul className={styles.checkinItems}>
            {checkin.items.map((i) => (
              <li key={i.itemId} className={styles.checkinItem}>
                <span className={`${styles.badge} ${styles[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                <span className={styles.ciLabel}>{i.label}</span>
                <span className={styles.ciNote}>{i.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div className={styles.pending}>
          <p className={styles.pendingHead}>Decidir:</p>
          <ul className={styles.items}>
            {pending.map((i) => (
              <li key={i.id} className={styles.item}>
                <div className={styles.itemBody}>
                  <span className={styles.itemLabel}>{i.title}</span>
                  <span className={`${styles.itemSaving} tnum`}>
                    {formatBRL(i.savingCents)}/mês
                  </span>
                </div>
                <div className={styles.decide}>
                  <button
                    type="button"
                    onClick={() => decide(i.id, true)}
                    className={styles.accept}
                    disabled={busy === i.id}
                  >
                    Aceitar
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(i.id, false)}
                    className={styles.reject}
                    disabled={busy === i.id}
                  >
                    Não
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
