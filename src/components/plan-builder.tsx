'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/month-summary'
import styles from './plan-builder.module.css'

interface Candidate {
  ruleId: string
  label: string
  savingCents: number
  annualCents: number
  pain: number
  reason: string
  kind: 'cancel' | 'downgrade' | 'reduce'
}

interface Proposal {
  targetCents: number
  items: Candidate[]
  totalSavingCents: number
  reached: boolean
  gapCents: number
  avgPain: number
}

const PAIN_LABEL = ['', 'indolor', 'quase indolor', 'dá pra sentir', 'dói', 'dói muito']

export function PlanBuilder() {
  const router = useRouter()
  const [target, setTarget] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [error, setError] = useState<string | null>(null)

  const targetCents = Math.round(Number(target.replace(/\./g, '').replace(',', '.')) * 100)

  async function propose(e: React.FormEvent) {
    e.preventDefault()
    if (!Number.isFinite(targetCents) || targetCents <= 0 || loading) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetCents }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para propor.')
        return
      }
      setProposal(data.proposal)
    } catch {
      setError('Falha de rede.')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!proposal) return
    setLoading(true)
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetCents: proposal.targetCents, save: true }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Não deu para salvar.')
        return
      }
      setProposal(null)
      setTarget('')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={styles.wrap} aria-labelledby="pb-h">
      <div className={styles.head}>
        <h2 id="pb-h" className={styles.title}>
          Quanto você quer economizar?
        </h2>
        <span className={styles.hint}>por mês</span>
      </div>

      <form onSubmit={propose} className={styles.form}>
        <div className={styles.inputWrap}>
          <span className={styles.prefix} aria-hidden>
            R$
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="2.000,00"
            className={`${styles.input} tnum`}
            disabled={loading}
            aria-label="Meta de economia mensal"
          />
        </div>
        <button type="submit" className={styles.btn} disabled={loading || !target.trim()}>
          {loading ? 'Pensando...' : 'Propor cortes'}
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {proposal && (
        <div className={styles.proposal}>
          <div className={styles.verdict}>
            {proposal.reached ? (
              <p className={styles.reached}>
                Dá pra economizar <strong>{formatBRL(proposal.totalSavingCents)}</strong> por mês
                com {proposal.items.length} {proposal.items.length === 1 ? 'corte' : 'cortes'}.
              </p>
            ) : (
              /* Dizer que nao chega e melhor que fingir que chega. */
              <p className={styles.notReached}>
                Cortando tudo que dá, chego em <strong>{formatBRL(proposal.totalSavingCents)}</strong>.
                Faltam {formatBRL(proposal.gapCents)} para a sua meta, e o resto é moradia, saúde,
                imposto ou gasto com a Zaya, que eu não sugiro cortar.
              </p>
            )}
          </div>

          <ul className={styles.items}>
            {proposal.items.map((i) => (
              <li key={i.ruleId} className={styles.item}>
                <span className={`${styles.pain} ${styles[`p${i.pain}`]}`} title={PAIN_LABEL[i.pain]}>
                  {PAIN_LABEL[i.pain]}
                </span>
                <div className={styles.itemBody}>
                  <span className={styles.itemLabel}>
                    {i.kind === 'reduce' ? 'Reduzir' : 'Cancelar'} {i.label}
                  </span>
                  <span className={styles.reason}>{i.reason}</span>
                </div>
                <div className={styles.amounts}>
                  <span className={`${styles.saving} tnum`}>{formatBRL(i.savingCents)}/mês</span>
                  <span className={`${styles.annual} tnum`}>{formatBRL(i.annualCents)}/ano</span>
                </div>
              </li>
            ))}
          </ul>

          <div className={styles.actions}>
            <button type="button" onClick={save} className={styles.btn} disabled={loading}>
              Criar plano
            </button>
            <button
              type="button"
              onClick={() => setProposal(null)}
              className={styles.btnGhost}
              disabled={loading}
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
