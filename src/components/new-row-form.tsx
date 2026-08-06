'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCategories } from './use-categories'
import styles from './ledger-row-editor.module.css'

/**
 * Linha nova na tabela, como inserir uma linha na planilha.
 *
 * Reusa o CSS do editor de linha: adicionar e editar sao a mesma interacao com
 * campos diferentes preenchidos, e ter dois visuais para isso confundiria.
 */

export function NewRowForm({
  kind,
  month,
  onClose,
}: {
  kind: 'expense' | 'income'
  month: string
  onClose: () => void
}) {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState('1')
  const [categorySlug, setCategorySlug] = useState(kind === 'expense' ? 'outros' : '')
  const [paid, setPaid] = useState(false)
  const categories = useCategories()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!description.trim()) {
      setError('Escreva a descrição.')
      return
    }
    if (!amount.trim()) {
      setError('Informe o valor.')
      return
    }

    const dayNum = Number(day)
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
      setError('Dia precisa ser entre 1 e 31.')
      return
    }

    // Clampa para o ultimo dia do mes: dia 31 em fevereiro nao existe.
    const [y, m] = month.split('-').map(Number) as [number, number]
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const dueDate = `${month}-${String(Math.min(dayNum, lastDay)).padStart(2, '0')}`

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          description,
          amount,
          dueDate,
          categorySlug: categorySlug || null,
          paid,
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
            placeholder={kind === 'expense' ? 'Conta de luz' : 'Salário'}
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

        {kind === 'expense' && (
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
        )}

        <label className={styles.check}>
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} disabled={busy} />
          <span>{kind === 'expense' ? 'Pago' : 'Recebido'}</span>
        </label>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={save} className={styles.save} disabled={busy}>
          {busy ? 'Salvando...' : 'Adicionar'}
        </button>
        <button type="button" onClick={onClose} className={styles.cancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
