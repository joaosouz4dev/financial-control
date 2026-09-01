'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Ledger, LedgerRow } from '@/lib/ledger'

/**
 * O estado da tabela do mes, compartilhado entre a tabela e os cards de cima.
 *
 * Antes a camada otimista vivia dentro da tabela: a linha respondia na hora,
 * mas Receita, Despesa e A pagar so mudavam quando o refresh do servidor
 * voltava. Apagar um item parecia nao ter funcionado ate o numero de cima
 * finalmente acompanhar.
 *
 * Aqui as duas partes leem a MESMA lista, entao elas nao tem como discordar.
 */

interface Store {
  ledger: Ledger
  applyLocal: (id: string, patch: Partial<LedgerRow>) => void
  removeLocal: (id: string) => void
  clearLocal: (id: string) => void
}

const Ctx = createContext<Store | null>(null)

export function useLedgerStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useLedgerStore precisa de <LedgerProvider>')
  return s
}

export function LedgerProvider({
  ledger: serverLedger,
  children,
}: {
  ledger: Ledger
  children: React.ReactNode
}) {
  const [overrides, setOverrides] = useState<Record<string, Partial<LedgerRow>>>({})
  /* Apagados: some da tela antes do servidor confirmar. Um id aqui vale mais
   * que qualquer override, entao vive separado. */
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  /* Quando os dados do servidor mudam, o local ja cumpriu seu papel. Sem isso a
   * copia local venceria para sempre e a tela ignoraria mudanca de fora. */
  const anterior = useRef(serverLedger)
  useEffect(() => {
    if (anterior.current !== serverLedger) {
      anterior.current = serverLedger
      setOverrides({})
      setRemoved(new Set())
    }
  }, [serverLedger])

  const ledger = useMemo(() => {
    const aplica = (rows: LedgerRow[]) =>
      rows.filter((r) => !removed.has(r.id)).map((r) => ({ ...r, ...overrides[r.id] }))

    const expenses = aplica(serverLedger.expenses)
    const incomes = aplica(serverLedger.incomes)

    /* Recalcula os totais das linhas visiveis, em vez de usar os do servidor:
     * e o que faz o card de cima cair junto com a linha que sumiu. */
    const soma = (rows: LedgerRow[]) => rows.reduce((s, r) => s + r.amountCents, 0)
    const pagos = (rows: LedgerRow[]) =>
      rows.filter((r) => r.paid).reduce((s, r) => s + r.amountCents, 0)

    return {
      expenses,
      incomes,
      totalExpenseCents: soma(expenses),
      totalIncomeCents: soma(incomes),
      paidExpenseCents: pagos(expenses),
    }
  }, [serverLedger, overrides, removed])

  const store = useMemo<Store>(
    () => ({
      ledger,
      applyLocal: (id, patch) => setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } })),
      removeLocal: (id) => setRemoved((s) => new Set(s).add(id)),
      clearLocal: (id) => {
        setOverrides((o) => {
          const { [id]: _, ...rest } = o
          return rest
        })
        setRemoved((s) => {
          if (!s.has(id)) return s
          const n = new Set(s)
          n.delete(id)
          return n
        })
      },
    }),
    [ledger],
  )

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
