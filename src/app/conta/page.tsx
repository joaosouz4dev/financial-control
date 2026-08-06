import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signOut } from '@/auth'
import { ThemeToggle } from '@/components/theme-toggle'
import { AccountForm } from '@/components/account-form'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function ContaPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href="/" className={styles.back} aria-label="Voltar ao dashboard">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className={styles.title}>Conta</h1>
            <p className={styles.subtitle}>{session.user.email}</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className={styles.main}>
        <AccountForm currentEmail={session.user.email ?? ''} />

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Sessão</h2>
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button type="submit" className={styles.signOut}>
              Sair
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
