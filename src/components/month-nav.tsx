import Link from 'next/link'
import styles from './month-nav.module.css'

export function MonthNav({ prev, next }: { prev: string | null; next: string | null }) {
  return (
    <nav className={styles.nav} aria-label="Navegar entre meses">
      {prev ? (
        <Link href={`/m/${prev}`} className={styles.btn} aria-label="Mês anterior">
          <Chevron dir="left" />
        </Link>
      ) : (
        <span className={`${styles.btn} ${styles.disabled}`} aria-hidden>
          <Chevron dir="left" />
        </span>
      )}
      {next ? (
        <Link href={`/m/${next}`} className={styles.btn} aria-label="Próximo mês">
          <Chevron dir="right" />
        </Link>
      ) : (
        <span className={`${styles.btn} ${styles.disabled}`} aria-hidden>
          <Chevron dir="right" />
        </span>
      )}
    </nav>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  )
}
