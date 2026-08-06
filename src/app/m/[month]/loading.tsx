import styles from '@/components/skeleton.module.css'

/**
 * Skeleton da pagina do mes.
 *
 * O Next mostra isto automaticamente enquanto a pagina busca do banco. Sem
 * ele, navegar entre meses congela a tela inteira sem feedback e parece
 * travado. O formato imita o layout real para a transicao nao dar solavanco.
 */
export default function Loading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="Carregando o mês">
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <div className={`${styles.logo} ${styles.shimmer}`} />
          <div className={styles.titleBlock}>
            <div className={`${styles.title} ${styles.shimmer}`} />
            <div className={`${styles.subtitle} ${styles.shimmer}`} />
          </div>
        </div>
        <div className={styles.headerActions}>
          <div className={`${styles.chip} ${styles.shimmer}`} />
          <div className={`${styles.chip} ${styles.shimmer}`} />
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.stats}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`${styles.statCard} ${styles.shimmer}`} />
          ))}
        </div>

        <div className={styles.ledgerGrid}>
          <div className={`${styles.ledgerCol} ${styles.shimmer}`} />
          <div className={`${styles.ledgerCol} ${styles.shimmer}`} />
        </div>

        <div className={styles.columns}>
          <div className={styles.colStack}>
            <div className={`${styles.panel} ${styles.shimmer}`} />
            <div className={`${styles.panel} ${styles.shimmer}`} />
          </div>
          <div className={styles.colStack}>
            <div className={`${styles.panel} ${styles.shimmer}`} />
          </div>
        </div>
      </main>
    </div>
  )
}
