'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './goals-editor.module.css'

/**
 * Edicao das metas por categoria, como o bloco OBJETIVO da planilha.
 *
 * As metas sao versionadas: salvar cria uma versao que vale a partir do mes
 * atual, sem reescrever o passado. Um mes historico continua avaliado contra a
 * meta que valia naquele mes.
 */

export interface GoalRow {
  categorySlug: string
  categoryName: string
  pct: number
}

export function GoalsEditor({ initial }: { initial: GoalRow[] }) {
  const router = useRouter()
  const [goals, setGoals] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const total = goals.reduce((s, g) => s + (Number.isFinite(g.pct) ? g.pct : 0), 0)

  function setPct(slug: string, value: string) {
    const pct = value === '' ? 0 : Number(value.replace(',', '.'))
    setGoals((gs) => gs.map((g) => (g.categorySlug === slug ? { ...g, pct } : g)))
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/goals', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goals: goals.map((g) => ({ categorySlug: g.categorySlug, pct: g.pct })) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Falha de rede.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="goals-h">
      <div className={styles.head}>
        <h2 id="goals-h" className={styles.title}>
          Metas por categoria
        </h2>
        <span className={styles.hint}>% da receita do mês</span>
      </div>

      <ul className={styles.list}>
        {goals.map((g) => (
          <li key={g.categorySlug} className={styles.row}>
            <label className={styles.name} htmlFor={`goal-${g.categorySlug}`}>
              {g.categoryName}
            </label>
            <div className={styles.inputWrap}>
              <input
                id={`goal-${g.categorySlug}`}
                type="number"
                min={0}
                max={100}
                step={1}
                value={Number.isFinite(g.pct) ? g.pct : 0}
                onChange={(e) => setPct(g.categorySlug, e.target.value)}
                className={`${styles.input} tnum`}
                disabled={busy}
              />
              <span className={styles.pct}>%</span>
            </div>
          </li>
        ))}
      </ul>

      <div className={styles.footer}>
        <span className={`${styles.total} ${total > 100 ? styles.over : ''}`}>
          Total: <span className="tnum">{total.toFixed(0)}%</span>
          {total > 100 && ' (acima da receita)'}
        </span>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className={styles.saved} role="status">
            Metas salvas. Valem a partir deste mês.
          </p>
        )}

        <button type="button" onClick={save} className={styles.btn} disabled={busy}>
          {busy ? 'Salvando...' : 'Salvar metas'}
        </button>
      </div>
    </section>
  )
}
