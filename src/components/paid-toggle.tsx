'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { LedgerRow } from '@/lib/ledger'
import styles from './paid-toggle.module.css'

/**
 * Marca pago / nao pago em um clique.
 *
 * Abrir o editor inteiro so para marcar um pagamento e atrito demais: e a
 * acao mais frequente do mes.
 *
 * O estado otimista nao vive mais aqui dentro: ele sobe para a tabela via
 * `applyLocal`. Enquanto morava neste componente, o botao trocava na hora mas
 * a linha (fundo, faixa da esquerda) so mudava quando o refresh do servidor
 * voltava, e a troca parecia meio feita.
 */
export function PaidToggle({
  id,
  paid,
  dueDate,
  label,
  applyLocal,
  clearLocal,
}: {
  id: string
  paid: boolean
  /** YYYY-MM-DD do vencimento: vira a data de pagamento ao marcar. */
  dueDate: string
  label: string
  applyLocal: (id: string, patch: Partial<LedgerRow>) => void
  clearLocal: (id: string) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function toggle(e: React.MouseEvent) {
    // Nao deixa o clique abrir o editor da linha.
    e.stopPropagation()

    const next = !paid
    applyLocal(id, { paid: next, paidDay: next ? Number(dueDate.slice(8, 10)) : null })

    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paidDate: next ? dueDate : null }),
      })
      if (!res.ok) {
        clearLocal(id) // servidor recusou: volta ao que ele diz
        return
      }
      startTransition(() => router.refresh())
    } catch {
      clearLocal(id)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`${styles.toggle} ${paid ? styles.paid : styles.pending} ${pending ? styles.busy : ''}`}
      aria-label={paid ? `${label}: pago, marcar como a pagar` : `${label}: a pagar, marcar como pago`}
      aria-pressed={paid}
      title={paid ? 'Pago (clique para desmarcar)' : 'A pagar (clique para marcar)'}
    >
      <span className={styles.icon} aria-hidden>
        {paid ? '✓' : '○'}
      </span>
      {paid ? 'Pago' : 'A pagar'}
    </button>
  )
}
