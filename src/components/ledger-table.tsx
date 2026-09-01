'use client'

import { useEffect, useRef, useState } from 'react'
import type { Ledger, LedgerRow } from '@/lib/ledger'
import { formatBRL } from '@/lib/month-summary'
import { LedgerRowEditor } from './ledger-row-editor'
import { PaidToggle } from './paid-toggle'
import { NewRowForm } from './new-row-form'
import { dueStatus, type DueStatus } from '@/lib/due-status'
import styles from './ledger-table.module.css'

/**
 * A tabela de lancamentos, densa como a planilha.
 *
 * Cada linha e clicavel e abre o editor inline: nome, valor, dia, categoria e
 * status. Usa a linguagem de cor da planilha (despesa avermelhada, receita
 * esverdeada) para o Joao reconhecer o ambiente.
 *
 * As quatro faixas da formatacao condicional da planilha continuam valendo:
 * pago, atrasado, vence em ate 3 dias, e em aberto (sem cor).
 */
/* Mapa explicito: 'due-soon' tem hifen e nao vira nome de classe por template. */
const ROW_CLASS: Record<DueStatus, string> = {
  paid: styles.row_paid!,
  overdue: styles.row_overdue!,
  'due-soon': styles.row_due_soon!,
  open: styles.row_open!,
}

export function LedgerTable({
  ledger,
  month,
  today,
}: {
  ledger: Ledger
  month: string
  /** Vem do servidor: o "hoje" do fuso do Joao, nao o do relogio do browser. */
  today: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState<'expense' | 'income' | null>(null)

  /* Mudancas ja aplicadas na tela, antes do servidor confirmar.
   *
   * Antes o estado otimista morava dentro do botao de pago: o botao trocava na
   * hora, mas a linha (cor de fundo, faixa da esquerda) so mudava quando o
   * refresh voltava do servidor, e o valor e o nome nem isso. Aqui a
   * sobreposicao vive na tabela, entao a linha inteira responde junto. */
  const [overrides, setOverrides] = useState<Record<string, Partial<LedgerRow>>>({})

  const applyLocal = (id: string, patch: Partial<LedgerRow>) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }))

  /* Descarta a sobreposicao: ou o servidor recusou, ou ja respondeu e os dados
   * novos chegaram por props. Manter a copia local depois disso faria a linha
   * ignorar mudanca vinda de outro lugar. */
  const clearLocal = (id: string) =>
    setOverrides((o) => {
      const { [id]: _, ...rest } = o
      return rest
    })

  const merge = (r: LedgerRow): LedgerRow => ({ ...r, ...overrides[r.id] })

  /* Quando os dados do servidor mudam, a sobreposicao ja cumpriu seu papel.
   *
   * Sem isso, a copia local venceria para sempre: apagar um lancamento e
   * recriar com o mesmo id, ou editar em outra aba, deixaria a linha exibindo
   * o valor antigo indefinidamente. */
  const anterior = useRef(ledger)
  useEffect(() => {
    if (anterior.current !== ledger) {
      anterior.current = ledger
      setOverrides({})
    }
  }, [ledger])

  return (
    <div className={styles.grid}>
      <LedgerColumn
        title="Despesas"
        tone="expense"
        rows={ledger.expenses.map(merge)}
        totalCents={ledger.totalExpenseCents}
        subtitle={`${formatBRL(ledger.paidExpenseCents)} pago`}
        month={month}
        editing={editing}
        setEditing={setEditing}
        adding={adding === 'expense'}
        setAdding={setAdding}
        today={today}
        applyLocal={applyLocal}
        clearLocal={clearLocal}
      />
      <LedgerColumn
        title="Receitas"
        tone="income"
        rows={ledger.incomes.map(merge)}
        totalCents={ledger.totalIncomeCents}
        subtitle={`${ledger.incomes.length} ${ledger.incomes.length === 1 ? 'fonte' : 'fontes'}`}
        month={month}
        editing={editing}
        setEditing={setEditing}
        adding={adding === 'income'}
        setAdding={setAdding}
        today={today}
        applyLocal={applyLocal}
        clearLocal={clearLocal}
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
  month,
  editing,
  setEditing,
  adding,
  setAdding,
  today,
  applyLocal,
  clearLocal,
}: {
  title: string
  tone: 'expense' | 'income'
  rows: LedgerRow[]
  totalCents: number
  subtitle: string
  month: string
  editing: string | null
  setEditing: (id: string | null) => void
  adding: boolean
  setAdding: (k: 'expense' | 'income' | null) => void
  today: string
  applyLocal: (id: string, patch: Partial<LedgerRow>) => void
  clearLocal: (id: string) => void
}) {
  return (
    <section className={`${styles.col} ${styles[tone]}`} aria-label={title}>
      <header className={styles.colHead}>
        <div className={styles.colTitleRow}>
          <h3 className={styles.colTitle}>{title}</h3>
          <span className={styles.colCount}>{rows.length}</span>
        </div>
        <div className={styles.colHeadRight}>
          <div className={styles.colTotals}>
            <strong className={`${styles.colTotal} tnum`}>{formatBRL(totalCents)}</strong>
            <span className={styles.colSub}>{subtitle}</span>
          </div>
          <button
            type="button"
            onClick={() => setAdding(adding ? null : tone)}
            className={styles.addBtn}
            aria-label={`Adicionar ${tone === 'expense' ? 'despesa' : 'receita'}`}
            aria-expanded={adding}
          >
            + Adicionar
          </button>
        </div>
      </header>

      {adding && (
        <NewRowForm kind={tone} month={month} onClose={() => setAdding(null)} />
      )}

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
                <th className={styles.thStatus} scope="col">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = dueStatus(r, today)
                return editing === r.id ? (
                  <tr key={r.id} className={styles.editingRow}>
                    <td colSpan={4}>
                      <LedgerRowEditor
                        row={r}
                        month={month}
                        onClose={() => setEditing(null)}
                        applyLocal={applyLocal}
                        clearLocal={clearLocal}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={r.id}
                    className={`${ROW_CLASS[st]} ${styles.clickable}`}
                    onClick={() => setEditing(r.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Editar ${r.description}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setEditing(r.id)
                      }
                    }}
                  >
                    <td className={`${styles.tdDay} tnum`}>
                      <span className={styles.day}>{r.dueDay}</span>
                    </td>
                    <td className={styles.tdDesc}>
                      <span className={styles.desc}>{r.description}</span>
                      {r.categoryName && (
                        <span className={styles.cat}>
                          {/* O ponto e reforco: o nome ao lado carrega a
                              identidade, entao a cor nunca decide sozinha. */}
                          <span
                            className={styles.catDot}
                            style={
                              r.categoryColor
                                ? ({
                                    '--cat-light': r.categoryColor.light,
                                    '--cat-dark': r.categoryColor.dark,
                                  } as React.CSSProperties)
                                : undefined
                            }
                            aria-hidden
                          />
                          {r.categoryName}
                        </span>
                      )}
                    </td>
                    <td className={`${styles.tdValue} tnum`}>{formatBRL(r.amountCents)}</td>
                    <td className={styles.tdStatus}>
                      <PaidToggle
                        id={r.id}
                        paid={r.paid}
                        applyLocal={applyLocal}
                        clearLocal={clearLocal}
                        dueDate={r.dueDate}
                        label={r.description}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
