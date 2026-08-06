'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import styles from './paid-toggle.module.css'

/**
 * Marca pago / nao pago em um clique.
 *
 * Abrir o editor inteiro so para marcar um pagamento e atrito demais: e a
 * acao mais frequente do mes. O estado troca na hora (otimista) e reverte se
 * o servidor recusar.
 */
export function PaidToggle({
  id,
  paid,
  dueDate,
  label,
}: {
  id: string
  paid: boolean
  /** YYYY-MM-DD do vencimento: vira a data de pagamento ao marcar. */
  dueDate: string
  label: string
}) {
  const router = useRouter()
  const [optimistic, setOptimistic] = useState(paid)
  const [pending, startTransition] = useTransition()

  async function toggle(e: React.MouseEvent) {
    // Nao deixa o clique abrir o editor da linha.
    e.stopPropagation()

    const next = !optimistic
    setOptimistic(next)

    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paidDate: next ? dueDate : null }),
      })
      if (!res.ok) {
        setOptimistic(!next) // reverte
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setOptimistic(!next)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`${styles.toggle} ${optimistic ? styles.paid : styles.pending} ${pending ? styles.busy : ''}`}
      aria-label={optimistic ? `${label}: pago, marcar como a pagar` : `${label}: a pagar, marcar como pago`}
      aria-pressed={optimistic}
      title={optimistic ? 'Pago (clique para desmarcar)' : 'A pagar (clique para marcar)'}
    >
      <span className={styles.icon} aria-hidden>
        {optimistic ? '✓' : '○'}
      </span>
      {optimistic ? 'Pago' : 'A pagar'}
    </button>
  )
}
