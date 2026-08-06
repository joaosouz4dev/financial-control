'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/month-summary'
import styles from './quick-entry.module.css'

interface Preview {
  ok: boolean
  error?: string
  resolved?: {
    kind: 'income' | 'expense'
    intent: 'record' | 'price_change' | 'new_recurring' | 'cancel'
    amountCents: number
    amountExpression: string | null
    labelHint: string
    date: string
    ambiguity: string | null
    confidence: number
  }
  match?: { transactionId: string; label: string; expectedCents: number; score: number; reasons: string[] } | null
  alternatives?: Array<{ transactionId: string; label: string; expectedCents: number; score: number }>
  isNew?: boolean
}

const INTENT_LABEL: Record<string, string> = {
  record: 'lançar',
  price_change: 'atualizar preço',
  new_recurring: 'nova recorrência',
  cancel: 'cancelar',
}

export function QuickEntry() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [previews, setPreviews] = useState<Preview[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<Record<number, string | null>>({})

  async function analyze(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || loading) return

    setLoading(true)
    setError(null)
    setPreviews(null)
    setDone(null)

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para analisar.')
        return
      }
      setPreviews(data.previews)
      const initial: Record<number, string | null> = {}
      data.previews.forEach((p: Preview, i: number) => {
        initial[i] = p.match?.transactionId ?? null
      })
      setPicked(initial)
    } catch {
      setError('Falha de rede. Tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (!previews) return
    setLoading(true)
    setError(null)

    const items = previews
      .filter((p): p is Preview & { resolved: NonNullable<Preview['resolved']> } => p.ok && !!p.resolved)
      .map((p, i) => ({
        kind: p.resolved.kind,
        intent: p.resolved.intent,
        amountCents: p.resolved.amountCents,
        amountExpression: p.resolved.amountExpression,
        labelHint: p.resolved.labelHint,
        date: p.resolved.date,
        matchedTransactionId: picked[i] ?? null,
        categorySlug: null,
      }))

    try {
      const res = await fetch('/api/extract/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: text, items }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para gravar.')
        return
      }
      setDone(data.applied.map((a: { action: string; label: string }) => `${a.label}: ${a.action}`))
      setPreviews(null)
      setText('')
    } catch {
      setError('Falha de rede. Tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={styles.wrap} aria-labelledby="qe-h">
      <div className={styles.head}>
        <h2 id="qe-h" className={styles.title}>
          Lançar escrevendo
        </h2>
        <span className={styles.hint}>confirma antes de gravar</span>
      </div>

      <form onSubmit={analyze} className={styles.form}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="paguei 90 de água hoje"
          className={styles.input}
          disabled={loading}
          aria-label="O que você quer lançar"
        />
        <button type="submit" className={styles.btn} disabled={loading || !text.trim()}>
          {loading ? 'Lendo...' : 'Analisar'}
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {done && (
        <ul className={styles.done} role="status">
          {done.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}

      {previews && (
        <div className={styles.previews}>
          {previews.map((p, i) => (
            <article key={i} className={styles.preview}>
              {!p.ok || !p.resolved ? (
                <p className={styles.error}>{p.error}</p>
              ) : (
                <>
                  <div className={styles.pvHead}>
                    <span className={`${styles.badge} ${styles[p.resolved.intent]}`}>
                      {INTENT_LABEL[p.resolved.intent]}
                    </span>
                    <strong className={styles.pvLabel}>{p.resolved.labelHint}</strong>
                    <span className={`${styles.pvValue} tnum`}>{formatBRL(p.resolved.amountCents)}</span>
                  </div>

                  <p className={styles.pvMeta}>
                    {p.resolved.date.split('-').reverse().join('/')}
                    {p.resolved.amountExpression && ` · ${p.resolved.amountExpression}`}
                  </p>

                  {p.match && (
                    <p className={styles.matched}>
                      Baixa: <strong>{p.match.label}</strong> ({formatBRL(p.match.expectedCents)} previsto)
                      <span className={styles.reasons}>{p.match.reasons.join(' · ')}</span>
                    </p>
                  )}

                  {p.alternatives && p.alternatives.length > 0 && (
                    <div className={styles.ask}>
                      <p className={styles.askLabel}>Qual desses?</p>
                      <div className={styles.options}>
                        {p.alternatives.map((a) => (
                          <button
                            key={a.transactionId}
                            type="button"
                            onClick={() => setPicked({ ...picked, [i]: a.transactionId })}
                            className={`${styles.opt} ${picked[i] === a.transactionId ? styles.optOn : ''}`}
                          >
                            {a.label} · {formatBRL(a.expectedCents)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setPicked({ ...picked, [i]: null })}
                          className={`${styles.opt} ${picked[i] === null ? styles.optOn : ''}`}
                        >
                          Nenhum, é novo
                        </button>
                      </div>
                    </div>
                  )}

                  {p.isNew && !p.match && <p className={styles.new}>Lançamento novo</p>}
                  {p.resolved.ambiguity && <p className={styles.ambig}>{p.resolved.ambiguity}</p>}
                </>
              )}
            </article>
          ))}

          <div className={styles.actions}>
            <button type="button" onClick={confirm} className={styles.btn} disabled={loading}>
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setPreviews(null)}
              className={styles.btnGhost}
              disabled={loading}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
