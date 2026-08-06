/**
 * O estado de um lancamento na tabela: a formatacao condicional da planilha.
 *
 * O Joao usava quatro regras no Sheets. A do amarelo era:
 *
 *   =AND($C2=""; $D2>=DAY(TODAY()); $D2<=DAY(TODAY())+3)
 *
 * Ou seja: nao pago E vence de hoje ate daqui a 3 dias. Aqui vale a mesma
 * ideia, com duas diferencas que a planilha nao tinha como resolver:
 *
 * 1. A planilha comparava DIA do mes (DAY), entao no fim do mes a janela
 *    quebrava: dia 30 + 3 = 33, que nao existe. Aqui a comparacao e por data
 *    completa, entao a janela atravessa o mes.
 * 2. Meses que nao sao o atual nao tem "hoje". Um mes passado nao fica todo
 *    vermelho, nem um mes futuro todo amarelo.
 */

export type DueStatus = 'paid' | 'overdue' | 'due-soon' | 'open'

/** Dias de antecedencia do amarelo, como o +3 da formula original. */
export const SOON_WINDOW_DAYS = 3

export function dueStatus(
  { paid, dueDate }: { paid: boolean; dueDate: string },
  today: string,
): DueStatus {
  if (paid) return 'paid'

  // Comparacao lexicografica: YYYY-MM-DD ordena como data, sem fuso no meio.
  if (dueDate < today) return 'overdue'

  const limit = addDays(today, SOON_WINDOW_DAYS)
  if (dueDate <= limit) return 'due-soon'

  return 'open'
}

/** Soma dias a uma data ISO, atravessando mes e ano. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}
