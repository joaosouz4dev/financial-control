import { redirect } from 'next/navigation'
import { auth, signOut } from '@/auth'
import { AppHeader } from '@/components/app-header'
import { AccountForm } from '@/components/account-form'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function ContaPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className={styles.shell}>
      <AppHeader title="Conta" subtitle={session.user.email ?? undefined} />

      <main className={styles.main}>
        <AccountForm currentEmail={session.user.email ?? ''} />

        <section className={styles.sessionPanel}>
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
