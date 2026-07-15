import styles from './page.module.css'

export default function VazioPage() {
  return (
    <main className={styles.empty}>
      <h1>Nenhum dado ainda</h1>
      <p>
        Coloque os arquivos <code>Controle Financeiro MM_AAAA.xlsx</code> em{' '}
        <code>/planilhas</code> e rode:
      </p>
      <pre className={styles.cmd}>pnpm import:xlsx</pre>
      <p className={styles.hint}>
        O importador é idempotente: rodar de novo não duplica nada.
      </p>
    </main>
  )
}
