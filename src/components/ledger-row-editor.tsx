'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { LedgerRow } from '@/lib/ledger'
import { useCategories } from './use-categories'
import styles from './ledger-row-editor.module.css'

/**
 * Editor inline de um lancamento: nome, valor, dia, categoria e status.
 *
 * O valor aceita formula ("=4*550"), do mesmo jeito que a planilha. Quem
 * avalia e o servidor, com Decimal.
 */

export function LedgerRowEditor({
  row,
  month,
  onClose,
}: {
  row: LedgerRow
  month: string
  onClose: () => void
}) {
  const router = useRouter()
  const [description, setDescription] = useState(row.description)
  const [amount, setAmount] = useState((row.amountCents / 100).toFixed(2).replace('.', ','))
  const [day, setDay] = useState(String(row.dueDay))
  const [categorySlug, setCategorySlug] = useState(row.categorySlug ?? '')
  const [paid, setPaid] = useState(row.paid)
  const categories = useCategories()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* confirm() nativo e sincrono: trava o renderer inteiro enquanto o dialogo
   * esta aberto. A confirmacao vive na propria linha, em dois passos. */
  const [confirming, setConfirming] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)

    const dayNum = Number(day)
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
      setError('Dia precisa ser entre 1 e 31.')
      setBusy(false)
      return
    }

    // Clampa para o ultimo dia do mes: dia 31 em fevereiro nao existe.
    const [y, m] = month.split('-').map(Number) as [number, number]
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const safeDay = Math.min(dayNum, lastDay)
    const dueDate = `${month}-${String(safeDay).padStart(2, '0')}`

    try {
      const res = await fetch(`/api/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description,
          amount,
          dueDate,
          categorySlug: categorySlug || null,
          paidDate: paid ? dueDate : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar.')
        return
      }
      onClose()
      router.refresh()
    } catch {
      setError('Falha de rede.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch(`/api/transactions/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Não deu para apagar.')
        return
      }
      onClose()
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.editor}>
      <div className={styles.fields}>
        <label className={styles.fieldWide}>
          <span className={styles.label}>Descrição</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={styles.input}
            disabled={busy}
            autoFocus
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Valor</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${styles.input} tnum`}
            disabled={busy}
            placeholder="89,59 ou =4*550"
          />
        </label>

        <label className={styles.fieldNarrow}>
          <span className={styles.label}>Dia</span>
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className={`${styles.input} tnum`}
            disabled={busy}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Categoria</span>
          <select
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
            className={styles.input}
            disabled={busy}
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
            disabled={busy}
          />
          <span>Pago</span>
        </label>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={save} className={styles.save} disabled={busy}>
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
        <button type="button" onClick={onClose} className={styles.cancel} disabled={busy}>
          Cancelar
        </button>
        {confirming ? (
          <span className={styles.confirmBar} role="alertdialog" aria-label="Confirmar exclusão">
            <span className={styles.confirmText}>Apagar mesmo?</span>
            <button type="button" onClick={remove} className={styles.deleteYes} disabled={busy}>
              {busy ? 'Apagando...' : 'Sim, apagar'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={styles.cancel}
              disabled={busy}
            >
              Não
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={styles.delete}
            disabled={busy}
          >
            Apagar
          </button>
        )}
      </div>
    </div>
  )
}
