import type { Ledger, LedgerRow } from '@/lib/ledger'
import { formatBRL } from '@/lib/month-summary'
import styles from './ledger-table.module.css'

/**
 * A tabela de lancamentos, densa como a planilha.
 *
 * Traz de volta o que o dashboard tinha escondido: cada despesa e receita em
 * linha, com dia, valor, categoria e status. Usa a linguagem de cor da
 * planilha (despesa avermelhada, receita esverdeada) para que o Joao
 * reconheca o ambiente, mas dentro da identidade do app.
 */
export function LedgerTable({ ledger }: { ledger: Ledger }) {
  return (
    <div className={styles.grid}>
      <LedgerColumn
        title="Despesas"
        tone="expense"
        rows={ledger.expenses}
        totalCents={ledger.totalExpenseCents}
        subtitle={`${formatBRL(ledger.paidExpenseCents)} pago`}
      />
      <LedgerColumn
        title="Receitas"
        tone="income"
        rows={ledger.incomes}
        totalCents={ledger.totalIncomeCents}
        subtitle={`${ledger.incomes.length} ${ledger.incomes.length === 1 ? 'fonte' : 'fontes'}`}
      />
    </div>
  )
}

function LedgerColumn({
  title,
  tone,
  rows,
  totalCents,
  subtitle,
}: {
  title: string
  tone: 'expense' | 'income'
  rows: LedgerRow[]
  totalCents: number
  subtitle: string
}) {
  return (
    <section className={`${styles.col} ${styles[tone]}`} aria-label={title}>
      <header className={styles.colHead}>
        <div className={styles.colTitleRow}>
          <h3 className={styles.colTitle}>{title}</h3>
          <span className={styles.colCount}>{rows.length}</span>
        </div>
        <div className={styles.colTotals}>
          <strong className={`${styles.colTotal} tnum`}>{formatBRL(totalCents)}</strong>
          <span className={styles.colSub}>{subtitle}</span>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className={styles.empty}>Nenhum lançamento.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thDay} scope="col">
                  Dia
                </th>
                <th scope="col">Descrição</th>
                <th className={styles.thValue} scope="col">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.paid ? styles.rowPaid : styles.rowDue}>
                  <td className={`${styles.tdDay} tnum`}>
                    <span className={styles.day}>{r.dueDay}</span>
                  </td>
                  <td className={styles.tdDesc}>
                    <span className={styles.desc}>{r.description}</span>
                    {r.categoryName && <span className={styles.cat}>{r.categoryName}</span>}
                  </td>
                  <td className={`${styles.tdValue} tnum`}>
                    {formatBRL(r.amountCents)}
                    <span
                      className={`${styles.status} ${r.paid ? styles.paid : styles.pending}`}
                      title={r.paid ? `pago dia ${r.paidDay}` : 'a pagar'}
                    >
                      {r.paid ? '✓' : '○'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
