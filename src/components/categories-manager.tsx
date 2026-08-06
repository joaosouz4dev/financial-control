'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PaletteSlot } from '@/lib/categories/palette'
import styles from './categories-manager.module.css'

/**
 * Criar, renomear, recolorir e arquivar categoria.
 *
 * O slug nunca muda ao renomear: ele e a chave que o importador de planilha e as
 * regras de recorrencia usam para reencontrar a categoria. Renomear troca so a
 * etiqueta que aparece na tela.
 */

export interface CategoryItem {
  id: string
  slug: string
  name: string
  colorKey: string | null
  colors: { light: string; dark: string }
  transactionCount: number
}

export function CategoriesManager({
  initial,
  palette,
}: {
  initial: CategoryItem[]
  palette: PaletteSlot[]
}) {
  const router = useRouter()
  /* A lista vem do servidor a cada refresh. Guardar numa copia local congelaria
   * ela: criar categoria gravava no banco e a tela nao mudava. */
  const items = initial
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name || busy) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para criar.')
        return
      }
      setNewName('')
      router.refresh()
    } catch {
      setError('Falha de rede.')
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: string, body: { name?: string; colorKey?: string }) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar.')
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Falha de rede.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function archive(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para arquivar.')
        return
      }
      setConfirming(null)
      router.refresh()
    } catch {
      setError('Falha de rede.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <form onSubmit={create} className={styles.newRow}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nome da nova categoria"
          className={styles.newInput}
          disabled={busy}
          aria-label="Nome da nova categoria"
          maxLength={40}
        />
        <button type="submit" className={styles.create} disabled={busy || !newName.trim()}>
          Criar
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {items.map((c) => (
          <li key={c.id} className={styles.item}>
            <span
              className={styles.dot}
              style={
                {
                  '--cat-light': c.colors.light,
                  '--cat-dark': c.colors.dark,
                } as React.CSSProperties
              }
              aria-hidden
            />

            {editing === c.id ? (
              <NameEdit
                initial={c.name}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={async (name) => {
                  if (await patch(c.id, { name })) setEditing(null)
                }}
              />
            ) : (
              <button
                type="button"
                className={styles.name}
                onClick={() => setEditing(c.id)}
                disabled={busy}
              >
                {c.name}
              </button>
            )}

            <span className={`${styles.count} tnum`}>
              {c.transactionCount} {c.transactionCount === 1 ? 'lançamento' : 'lançamentos'}
            </span>

            <span className={styles.swatches} role="group" aria-label={`Cor de ${c.name}`}>
              {palette.map((slot) => (
                <button
                  key={slot.key}
                  type="button"
                  className={`${styles.swatch} ${c.colorKey === slot.key ? styles.swatchOn : ''}`}
                  style={
                    {
                      '--cat-light': slot.light,
                      '--cat-dark': slot.dark,
                    } as React.CSSProperties
                  }
                  title={slot.name}
                  aria-label={slot.name}
                  aria-pressed={c.colorKey === slot.key}
                  disabled={busy}
                  onClick={() => patch(c.id, { colorKey: slot.key })}
                />
              ))}
            </span>

            {confirming === c.id ? (
              <span className={styles.confirmBar}>
                <span className={styles.confirmText}>
                  Arquivar? Os {c.transactionCount} lançamentos ficam como estão.
                </span>
                <button
                  type="button"
                  className={styles.archiveYes}
                  onClick={() => archive(c.id)}
                  disabled={busy}
                >
                  Arquivar
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => setConfirming(null)}
                  disabled={busy}
                >
                  Não
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={styles.archive}
                onClick={() => setConfirming(c.id)}
                disabled={busy}
              >
                Arquivar
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        Arquivar tira a categoria das listas novas e mantém o que já foi lançado. Renomear troca só a
        etiqueta: o identificador interno continua o mesmo, então o importador de planilha segue
        reconhecendo a categoria.
      </p>
    </div>
  )
}

function NameEdit({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string
  busy: boolean
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)

  return (
    <span className={styles.nameEdit}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={styles.nameInput}
        disabled={busy}
        maxLength={40}
        autoFocus
        aria-label="Novo nome"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(value.trim())
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button
        type="button"
        className={styles.save}
        onClick={() => onSave(value.trim())}
        disabled={busy || !value.trim()}
      >
        Salvar
      </button>
      <button type="button" className={styles.ghost} onClick={onCancel} disabled={busy}>
        Cancelar
      </button>
    </span>
  )
}
