/**
 * Acompanhamento do plano: o sistema cobra.
 *
 * Um plano que so propoe e um post-it. O ciclo se fecha comparando, mes a mes,
 * o que ele aceitou cortar com o que de fato gastou. Deterministico: entra o
 * aceito e o realizado, sai o veredito.
 */

export interface AcceptedItem {
  itemId: string
  ruleId: string | null
  label: string
  savingCents: number
  /** Valor que ele gastava antes do corte. */
  baselineCents: number
  kind: 'cancel' | 'downgrade' | 'reduce'
}

export interface ActualSpend {
  ruleId: string | null
  label: string
  amountCents: number
}

export type ItemStatus = 'kept' | 'partial' | 'broken' | 'unknown'

export interface ItemCheckin {
  itemId: string
  label: string
  status: ItemStatus
  expectedCents: number
  actualCents: number
  /** Economia real: baseline menos o que gastou. */
  savedCents: number
  note: string
}

export interface PlanCheckin {
  month: string
  items: ItemCheckin[]
  promisedCents: number
  savedCents: number
  /** Cumpriu a promessa? */
  onTrack: boolean
  keptCount: number
  brokenCount: number
}

/**
 * Confere o mes contra o que ele prometeu.
 *
 * Cancelamento: gastou zero = cumpriu. Reducao: gastou ate o alvo = cumpriu,
 * gastou entre o alvo e o baseline = parcial.
 */
export function checkinMonth(
  month: string,
  accepted: AcceptedItem[],
  actual: ActualSpend[],
): PlanCheckin {
  const byRule = new Map<string, number>()
  const byLabel = new Map<string, number>()
  for (const a of actual) {
    if (a.ruleId) byRule.set(a.ruleId, (byRule.get(a.ruleId) ?? 0) + a.amountCents)
    byLabel.set(norm(a.label), (byLabel.get(norm(a.label)) ?? 0) + a.amountCents)
  }

  const items: ItemCheckin[] = accepted.map((a) => {
    const spent = a.ruleId ? byRule.get(a.ruleId) : byLabel.get(norm(a.label))

    // Nao apareceu no realizado.
    if (spent === undefined) {
      // Para cancelamento, sumir E o sucesso.
      if (a.kind === 'cancel') {
        return {
          itemId: a.itemId,
          label: a.label,
          status: 'kept',
          expectedCents: 0,
          actualCents: 0,
          savedCents: a.savingCents,
          note: 'cancelado, não apareceu no mês',
        }
      }
      // Para reducao, sumir e estranho: o mercado nao deixa de existir.
      return {
        itemId: a.itemId,
        label: a.label,
        status: 'unknown',
        expectedCents: a.baselineCents - a.savingCents,
        actualCents: 0,
        savedCents: 0,
        note: 'não encontrei lançamento neste mês',
      }
    }

    const target = a.baselineCents - a.savingCents
    const saved = a.baselineCents - spent

    if (a.kind === 'cancel') {
      if (spent === 0) {
        return { itemId: a.itemId, label: a.label, status: 'kept', expectedCents: 0, actualCents: 0, savedCents: a.savingCents, note: 'cancelado' }
      }
      return {
        itemId: a.itemId,
        label: a.label,
        status: 'broken',
        expectedCents: 0,
        actualCents: spent,
        savedCents: 0,
        note: 'você tinha cancelado, mas voltou a aparecer',
      }
    }

    // Reducao: tolerancia de 5% para nao ser implicante com centavo.
    if (spent <= target * 1.05) {
      return { itemId: a.itemId, label: a.label, status: 'kept', expectedCents: target, actualCents: spent, savedCents: saved, note: 'dentro do combinado' }
    }
    if (spent < a.baselineCents) {
      return {
        itemId: a.itemId,
        label: a.label,
        status: 'partial',
        expectedCents: target,
        actualCents: spent,
        savedCents: saved,
        note: 'reduziu, mas menos do que combinou',
      }
    }
    return {
      itemId: a.itemId,
      label: a.label,
      status: 'broken',
      expectedCents: target,
      actualCents: spent,
      savedCents: saved > 0 ? saved : 0,
      note: 'gastou igual ou mais que antes',
    }
  })

  const promised = accepted.reduce((s, a) => s + a.savingCents, 0)
  // Economia real nunca e negativa no total: gastar mais em um item nao "des-economiza"
  // o que outro item economizou, so nao conta.
  const saved = items.reduce((s, i) => s + Math.max(0, i.savedCents), 0)

  return {
    month,
    items,
    promisedCents: promised,
    savedCents: saved,
    onTrack: saved >= promised * 0.9,
    keptCount: items.filter((i) => i.status === 'kept').length,
    brokenCount: items.filter((i) => i.status === 'broken').length,
  }
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}
