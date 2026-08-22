/**
 * Quando uma regra de recorrencia deixou de valer.
 *
 * O import promove quase todo lancamento a regra (deservesRecurrence e
 * !oneOff), porque a fatura do cartao precisa existir no futuro projetado
 * mesmo variando de valor. O custo dessa escolha e que um trabalho avulso
 * tambem vira regra mensal sem fim, e o gerador cumpre o combinado: produz
 * ocorrencia todo mes, para sempre.
 *
 * O sintoma aparece longe da causa. Um mes futuro fica cheio de previsao
 * nascida de evento unico de anos atras, e o saldo projetado passa a
 * descrever um mes que nao vai acontecer.
 *
 * O criterio aqui e observacao, nao heuristica de texto: a regra vale
 * enquanto o lancamento continua aparecendo. Parou de aparecer ha
 * STALE_MONTHS, encerra em ends_on e a geracao para ali.
 */

/** Meses sem lancamento real ate a regra ser considerada morta. */
export const STALE_MONTHS = 12

export interface RuleActivity {
  id: string
  startsOn: string
  /** Data do ultimo lancamento real, ou null se a regra nunca teve nenhum. */
  lastSeen: string | null
}

export interface Retirement {
  id: string
  /** Data em que a regra passa a valer como encerrada. */
  endsOn: string
}

/**
 * Quais regras encerrar, dado o "hoje" de referencia.
 *
 * Recebe today explicito para ser deterministico: a decisao depende da data,
 * e um teste que le o relogio muda de resultado conforme o dia em que roda.
 */
export function selectStaleRules(
  rules: RuleActivity[],
  today: string,
  staleMonths = STALE_MONTHS,
): Retirement[] {
  const cutoff = monthsBefore(today, staleMonths)

  return rules
    .filter((r) => (r.lastSeen ?? r.startsOn) < cutoff)
    .map((r) => ({
      // Sem lancamento nenhum a regra nunca valeu: encerra no proprio inicio,
      // senao ela sobrevive ate o cutoff produzindo previsao que nunca existiu.
      id: r.id,
      endsOn: r.lastSeen ?? r.startsOn,
    }))
}

/** Subtrai meses de uma data ISO, clampando dia em mes curto (31 -> 28). */
export function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const total = y * 12 + (m - 1) - months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  const nd = Math.min(d, last)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}
