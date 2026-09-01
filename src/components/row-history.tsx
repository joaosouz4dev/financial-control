'use client'

import { useEffect, useState } from 'react'
import { describeEvent } from '@/lib/events/diff'
import styles from './row-history.module.css'

/**
 * O que aconteceu com este lancamento, do mais recente para o mais antigo.
 *
 * Responde "quando eu marquei isso como pago?" e "esse valor sempre foi esse?".
 * O `updatedAt` da transacao nao respondia: ele guarda so a ultima alteracao e
 * apaga a anterior.
 */

interface Evento {
  id: string
  kind: string
  fromValue: string | null
  toValue: string | null
  createdAt: string
}

export function RowHistory({ transactionId }: { transactionId: string }) {
  const [events, setEvents] = useState<Evento[] | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch(`/api/transactions/${transactionId}/events`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (vivo) setEvents(d.events)
      })
      .catch(() => {
        if (vivo) setErro(true)
      })
    return () => {
      vivo = false
    }
  }, [transactionId])

  if (erro) return <p className={styles.vazio}>Não deu para carregar o histórico.</p>
  if (events === null) return <p className={styles.vazio}>Carregando histórico...</p>

  if (events.length === 0) {
    return (
      <p className={styles.vazio}>
        Sem alterações registradas. Lançamentos importados da planilha não têm histórico anterior.
      </p>
    )
  }

  return (
    <div className={styles.wrap}>
      <h4 className={styles.titulo}>Histórico</h4>
      <ol className={styles.lista}>
        {events.map((e) => (
          <li key={e.id} className={styles.item}>
            <span className={`${styles.marca} ${styles[e.kind] ?? ''}`} aria-hidden />
            <span className={styles.texto}>{describeEvent(e)}</span>
            <time className={styles.quando} dateTime={e.createdAt}>
              {formatarQuando(e.createdAt)}
            </time>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** "hoje 14:32" e mais util que a data cheia para o que acabou de acontecer. */
function formatarQuando(iso: string): string {
  const d = new Date(iso)
  const agora = new Date()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const mesmoDia = d.toDateString() === agora.toDateString()
  if (mesmoDia) return `hoje ${hora}`

  const ontem = new Date(agora)
  ontem.setDate(ontem.getDate() - 1)
  if (d.toDateString() === ontem.toDateString()) return `ontem ${hora}`

  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${hora}`
}
