import styles from '@/components/skeleton.module.css'

export default function Loading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="Carregando o chat">
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <div className={`${styles.logo} ${styles.shimmer}`} />
          <div className={styles.titleBlock}>
            <div className={`${styles.title} ${styles.shimmer}`} />
            <div className={`${styles.subtitle} ${styles.shimmer}`} />
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <div className={`${styles.panel} ${styles.shimmer}`} />
      </main>
    </div>
  )
}
