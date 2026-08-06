import { LoginForm } from '@/components/login-form'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-5 4 3 8-8" />
              <path d="M16 7h5v5" />
            </svg>
          </div>
          <div>
            <h1 className={styles.title}>Controle Financeiro</h1>
            <p className={styles.subtitle}>Entre para ver suas finanças</p>
          </div>
        </div>

        <LoginForm hadError={error === 'CredentialsSignin'} />
      </div>
    </main>
  )
}
