'use client'

import { useActionState } from 'react'
import { loginAction } from '@/app/login/actions'
import styles from './login-form.module.css'

export function LoginForm({ hadError }: { hadError: boolean }) {
  const [state, formAction, pending] = useActionState(loginAction, hadError ? { error: 'Email ou senha incorretos.' } : null)

  return (
    <form action={formAction} className={styles.form}>
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          className={styles.input}
          disabled={pending}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Senha</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={styles.input}
          disabled={pending}
        />
      </label>

      {state?.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className={styles.btn} disabled={pending}>
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
