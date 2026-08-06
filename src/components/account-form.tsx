'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './account-form.module.css'

/**
 * Troca de email e senha. Sempre exige a senha atual, mesmo para mudar so o
 * email: sem isso, quem pegasse a sessao aberta tomaria a conta.
 */
export function AccountForm({ currentEmail }: { currentEmail: string }) {
  const router = useRouter()
  const [email, setEmail] = useState(currentEmail)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (newPassword && newPassword !== confirmPassword) {
      setError('A nova senha e a confirmação não batem.')
      return
    }

    const emailChanged = email.trim().toLowerCase() !== currentEmail.toLowerCase()
    if (!emailChanged && !newPassword) {
      setError('Nada para mudar: informe um novo email ou uma nova senha.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          ...(emailChanged ? { email: email.trim() } : {}),
          ...(newPassword ? { newPassword } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar.')
        return
      }
      setDone(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // Credenciais mudaram: forca novo login.
      setTimeout(() => router.push('/login'), 1800)
    } catch {
      setError('Falha de rede.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Email e senha</h2>

      <form onSubmit={save} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
            disabled={busy || done}
            autoComplete="email"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Senha atual</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={styles.input}
            disabled={busy || done}
            autoComplete="current-password"
            required
            placeholder="obrigatória para confirmar"
          />
        </label>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Nova senha</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={styles.input}
              disabled={busy || done}
              autoComplete="new-password"
              placeholder="deixe vazio para manter"
              minLength={8}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Confirmar</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={styles.input}
              disabled={busy || done || !newPassword}
              autoComplete="new-password"
            />
          </label>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {done && (
          <p className={styles.success} role="status">
            Salvo. Redirecionando para o login...
          </p>
        )}

        <button type="submit" className={styles.btn} disabled={busy || done}>
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
      </form>
    </section>
  )
}
