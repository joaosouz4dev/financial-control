'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/month-summary'
import styles from './chat-view.module.css'

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
  }
  match?: { transactionId: string; label: string; expectedCents: number; reasons: string[] } | null
  alternatives?: Array<{ transactionId: string; label: string; expectedCents: number }>
  isNew?: boolean
}

interface Message {
  id: string
  role: string
  content: string
  payload?: { previews?: Preview[] } | null
  createdAt: string
}

const INTENT_LABEL: Record<string, string> = {
  record: 'lançar',
  price_change: 'atualizar preço',
  new_recurring: 'nova recorrência',
  cancel: 'cancelar',
}

export function ChatView({ initialMessages }: { initialMessages: Message[] }) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ previews: Preview[]; raw: string } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pending])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const raw = text.trim()
    if (!raw || busy) return

    setBusy(true)
    setText('')
    // Otimista: a mensagem aparece antes da resposta chegar.
    const temp: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: raw,
      createdAt: new Date().toISOString(),
    }
    setMessages((m) => [...m, temp])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      })
      const data = await res.json()

      setMessages((m) => [
        ...m.filter((x) => x.id !== temp.id),
        data.userMessage,
        data.assistantMessage,
      ])

      const usable = (data.previews ?? []).filter((p: Preview) => p.ok)
      if (usable.length > 0) setPending({ previews: data.previews, raw })
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'Falha de rede. Tente de novo.',
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!pending) return
    setBusy(true)

    const items = pending.previews
      .filter((p): p is Preview & { resolved: NonNullable<Preview['resolved']> } => p.ok && !!p.resolved)
      .map((p) => ({
        kind: p.resolved.kind,
        intent: p.resolved.intent,
        amountCents: p.resolved.amountCents,
        amountExpression: p.resolved.amountExpression,
        labelHint: p.resolved.labelHint,
        date: p.resolved.date,
        matchedTransactionId: p.match?.transactionId ?? null,
        categorySlug: null,
      }))

    try {
      const res = await fetch('/api/extract/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: pending.raw, items }),
      })
      const data = await res.json()
      const msg = res.ok
        ? `Pronto: ${data.applied.map((a: { label: string; action: string }) => `${a.label} ${a.action}`).join(', ')}.`
        : `Não deu para gravar: ${data.error}`

      setMessages((m) => [
        ...m,
        { id: `done-${Date.now()}`, role: 'assistant', content: msg, createdAt: new Date().toISOString() },
      ])
      setPending(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.thread}>
        {messages.length === 0 && (
          <div className={styles.welcome}>
            <p className={styles.welcomeTitle}>Escreva como você fala</p>
            <ul className={styles.examples}>
              <li>paguei 90 de água hoje</li>
              <li>netflix subiu pra 59,90</li>
              <li>recebi da Vansa</li>
              <li>mercado 550 por semana</li>
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`${styles.msg} ${m.role === 'user' ? styles.fromUser : styles.fromBot}`}
          >
            <div className={styles.bubble}>{m.content}</div>
          </div>
        ))}

        {pending && (
          <div className={styles.previewCard}>
            {pending.previews.map((p, i) =>
              !p.ok || !p.resolved ? (
                <p key={i} className={styles.pvError}>
                  {p.error}
                </p>
              ) : (
                <div key={i} className={styles.pvItem}>
                  <div className={styles.pvHead}>
                    <span className={`${styles.badge} ${styles[p.resolved.intent]}`}>
                      {INTENT_LABEL[p.resolved.intent]}
                    </span>
                    <strong className={styles.pvLabel}>{p.resolved.labelHint}</strong>
                    <span className={`${styles.pvValue} tnum`}>
                      {formatBRL(p.resolved.amountCents)}
                    </span>
                  </div>
                  <p className={styles.pvMeta}>
                    {p.resolved.date.split('-').reverse().join('/')}
                    {p.match && ` · baixa "${p.match.label}"`}
                    {p.isNew && !p.match && ' · lançamento novo'}
                  </p>
                </div>
              ),
            )}

            <div className={styles.pvActions}>
              <button type="button" onClick={confirm} className={styles.confirm} disabled={busy}>
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className={styles.discard}
                disabled={busy}
              >
                Descartar
              </button>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <form onSubmit={send} className={styles.composer}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="paguei 90 de água hoje"
          className={styles.input}
          disabled={busy}
          aria-label="Mensagem"
          autoFocus
        />
        <button type="submit" className={styles.send} disabled={busy || !text.trim()}>
          {busy ? '...' : 'Enviar'}
        </button>
      </form>
    </div>
  )
}
