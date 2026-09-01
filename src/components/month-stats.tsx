'use client'

import { formatBRL } from '@/lib/month-summary'
import { useLedgerStore } from './ledger-store'
import styles from '@/app/m/[month]/page.module.css'

/**
 * Receita, Despesa, A pagar e Previsao de saldo.
 *
 * Le do mesmo store que a tabela, entao os numeros caem junto com a linha que
 * some. Antes eram calculados no servidor: apagar um item deixava o card
 * mostrando o total antigo ate o refresh voltar, e parecia que nao funcionou.
 *
 * As metas (investmentTargetCents) e a comparacao com o mes anterior continuam
 * vindo do servidor: dependem de dados de outros meses, que a tabela nao tem.
 */
export function MonthStats({
  expenseDelta,
  investmentTargetCents,
}: {
  expenseDelta: number | null
  investmentTargetCents: number
}) {
  const { ledger } = useLedgerStore()

  const totalIncome = ledger.totalIncomeCents
  const totalExpense = ledger.totalExpenseCents
  const paid = ledger.paidExpenseCents
  const toPay = totalExpense - paid
  const received = ledger.incomes.filter((r) => r.paid).reduce((s, r) => s + r.amountCents, 0)
  const toReceive = totalIncome - received
  const projected = totalIncome - totalExpense

  return (
    <section className={styles.stats} aria-label="Resumo do mês">
      <article className={styles.stat}>
        <span className={styles.statLabel}>Receita</span>
        <strong className={`${styles.statValue} tnum`}>{formatBRL(totalIncome)}</strong>
        <span className={styles.statMeta}>{formatBRL(toReceive)} a receber</span>
      </article>

      <article className={styles.stat}>
        <span className={styles.statLabel}>Despesa</span>
        <strong className={`${styles.statValue} tnum`}>{formatBRL(totalExpense)}</strong>
        {expenseDelta !== null ? (
          <span className={`${styles.statMeta} ${expenseDelta > 0 ? styles.metaUp : styles.metaDown}`}>
            {expenseDelta > 0 ? '↑' : '↓'} {formatBRL(Math.abs(expenseDelta))} vs mês anterior
          </span>
        ) : (
          <span className={styles.statMeta}>{ledger.expenses.length} lançamentos</span>
        )}
      </article>

      <article className={styles.stat}>
        <span className={styles.statLabel}>A pagar</span>
        <strong className={`${styles.statValue} tnum`}>{formatBRL(toPay)}</strong>
        <span className={styles.statMeta}>{formatBRL(paid)} já pago</span>
      </article>

      <article className={`${styles.stat} ${styles.statHighlight}`}>
        <span className={styles.statLabel}>Previsão de saldo</span>
        <strong className={`${styles.statValue} tnum`}>{formatBRL(projected)}</strong>
        <span className={styles.statMeta}>
          meta de investimento: {formatBRL(investmentTargetCents)}
        </span>
      </article>
    </section>
  )
}
