/**
 * Motor de propostas de corte.
 *
 * Deterministico: entra o que ele gasta, sai uma lista ranqueada por
 * (economia x dor). A LLM depois narra, nao escolhe.
 *
 * A regra que organiza tudo: DOR NAO E OPINIAO, e estrutura. Um algoritmo
 * ingenuo ordena por valor e sugere cortar "Fraldas Zaya R$ 80" antes de
 * "Revolut Metal R$ 79,99", porque 80 > 79,99. Um plano que sugere cortar
 * fralda de bebe e pior que nenhum plano: destroi a confianca no sistema
 * inteiro e ele nunca mais abre a aba.
 */

export type PainLevel = 1 | 2 | 3 | 4 | 5

export interface Expense {
  ruleId: string
  label: string
  amountCents: number
  categorySlug: string | null
  /** Meses desde o ultimo sinal de uso. null = sem telemetria. */
  monthsSinceSignal?: number | null
  /** Parcelamento nao e cortavel: e divida contratada. */
  isInstallment?: boolean
}

export interface Candidate {
  ruleId: string
  label: string
  savingCents: number
  annualCents: number
  pain: PainLevel
  reason: string
  /** Economia por unidade de dor: o criterio de ranqueamento. */
  score: number
  kind: 'cancel' | 'downgrade' | 'reduce'
}

/**
 * Nunca sugerir cortar. Nao e sobre valor, e sobre o que a coisa E.
 *
 * Cada regex aqui e uma decisao de produto: o sistema prefere nao ajudar a
 * ajudar errado.
 */
const UNTOUCHABLE: Array<{ test: RegExp; why: string }> = [
  /**
   * Fatura de cartao NAO e assinatura: e o agregado das compras que ele ja
   * fez. "Cancelar Cartão João Caixa, economize R$ 1.808,60" e absurdo por
   * dois motivos: cancelar o cartao nao apaga a divida, e esse dinheiro ja
   * esta contado nas categorias das compras. Contaria economia inexistente.
   *
   * O caminho certo para o cartao e itemizar (ver lib/cards/itemize.ts) e
   * entao cortar as COMPRAS que aparecerem la dentro.
   */
  { test: /\bcart(a|ã)o\b|\bcartao\b|\bfatura\b/i, why: 'fatura de cartão: itemize para ver o que cortar' },
  // Filha. Nao entra em plano de economia, ponto.
  { test: /\bzaya\b/i, why: 'gasto com a filha' },
  { test: /\bfralda|\bleite\b|\blenç|\blenco|\bescola\b|\bmaterial\b|\bcreche\b|\bbab(a|á)\b/i, why: 'gasto com a filha' },
  /**
   * Animais comem. "Cancelar Ração dos Cachorros, economize R$ 150/mes" e o
   * mesmo erro de cortar fralda de bebe: economia real e conselho inaceitavel.
   */
  { test: /\bra(ç|c)(a|ã)o\b|\bcachorro|\bgato\b|\bpet\b|\bveterin(a|á)rio|\bvacina\b/i, why: 'animal de estimação' },
  // Saude e moradia: cortar aqui nao e economia, e risco.
  { test: /\bplano de sa(u|ú)de|\bconv(e|ê)nio|\bfarm(a|á)cia|\brem(e|é)dio|\bm(e|é)dico|\bdentista/i, why: 'saúde' },
  { test: /\bfinanciamento|\balugu?el\b|\bcondom(i|í)nio|\biptu\b/i, why: 'moradia' },
  { test: /\b(conta de )?(agua|água|luz|energia|g(a|á)s)\b/i, why: 'conta essencial de casa' },
  /**
   * Ele e desenvolvedor e trabalha de casa: internet e celular sao
   * infraestrutura de trabalho, nao conforto. "Cancele a internet, economize
   * R$ 99,90" custaria a receita inteira.
   */
  { test: /\binternet\b|\bbanda larga|\bfibra\b|\bcelular\b|\bvivo\b|\bclaro\b|\btim\b|\boi\b/i, why: 'infraestrutura de trabalho' },
  // Obrigacao legal da empresa.
  { test: /\bdas\b|\bimposto|\binss\b|\bcontador/i, why: 'obrigação fiscal' },
  // Seguro: cortar e trocar custo por risco.
  { test: /\bseguro\b/i, why: 'seguro' },
]

/**
 * Categorias onde CANCELAR nunca faz sentido, so reduzir.
 *
 * A lista de regex acima sempre vai ter buracos: eu esqueci os cachorros e a
 * internet na primeira versao, e vou esquecer outra coisa na proxima. Esta e a
 * trava estrutural que nao depende de adivinhar nomes: "cancelar Casa" ou
 * "cancelar Saude" e incoerente seja qual for o lancamento.
 */
const NEVER_CANCEL_CATEGORIES = new Set(['casa', 'saude', 'alimentacao', 'transporte'])

export function untouchableReason(label: string): string | null {
  for (const u of UNTOUCHABLE) {
    if (u.test.test(label)) return u.why
  }
  return null
}

/**
 * Dor estimada, de 1 (indolor) a 5 (doi).
 *
 * A escala e sobre o que ele PERDE, nao sobre quanto custa.
 */
export function estimatePain(e: Expense): PainLevel {
  // Sem sinal de uso ha muito tempo: cortar nao tira nada dele.
  if (e.monthsSinceSignal !== null && e.monthsSinceSignal !== undefined && e.monthsSinceSignal >= 3) {
    return 1
  }

  const l = e.label.toLowerCase()

  // Assinatura redundante: ele tem varias de video.
  if (/\bcrunchyroll|\bstremio|\bmeli\+|\bmeli plus/i.test(l)) return 2

  // Streaming que ele provavelmente usa.
  if (/\bnetflix|\byoutube|\bspotify|\bprime\b|\bdisney/i.test(l)) return 3

  // Ferramenta de trabalho: cortar pode custar produtividade ou receita.
  if (/\bvercel|\bcursor|\bgithub|\baws\b|\bmicrosoft|\bservidor|\boffice/i.test(l)) return 4

  // Transporte e mercado: comprimivel, mas nao cortavel.
  if (e.categorySlug === 'alimentacao' || e.categorySlug === 'transporte') return 4

  return 3
}

/**
 * Score: economia penalizada EXPONENCIALMENTE pela dor.
 *
 * Dividir por dor (savings/pain) e penalidade fraca demais: a Vercel (R$ 110,
 * dor 4, ferramenta de trabalho) ficava ACIMA do Crunchyroll (R$ 20, dor 1,
 * sem uso ha 5 meses), porque 110/4 > 20/1. Sugerir cortar a ferramenta de
 * trabalho antes de uma assinatura morta e o conselho errado.
 *
 * Com base 4, cada nivel de dor divide por 4: dor 4 custa 64x mais que dor 1.
 * Isso faz o que doi so aparecer quando a economia e MUITO maior, que e o
 * comportamento certo.
 */
function scoreOf(savingCents: number, pain: PainLevel): number {
  return savingCents / Math.pow(4, pain - 1)
}

/**
 * Propoe cortes ranqueados por economia x dor.
 *
 * Nao e o maior valor primeiro: e o que rende mais por unidade de sacrificio.
 */
export function proposeCandidates(expenses: Expense[]): Candidate[] {
  const out: Candidate[] = []

  for (const e of expenses) {
    const untouchable = untouchableReason(e.label)
    if (untouchable) continue

    // Parcelamento e divida contratada: nao da pra "cortar" o carro.
    if (e.isInstallment) continue

    // Abaixo de R$ 10/mes nao move o ponteiro e polui a lista: um plano com
    // "cancele o iFood, economize R$ 7,95" desqualifica o resto da lista.
    if (e.amountCents < 1000) continue

    const pain = estimatePain(e)
    const orphan =
      e.monthsSinceSignal !== null && e.monthsSinceSignal !== undefined && e.monthsSinceSignal >= 3

    // Categoria essencial se reduz, nao se cancela. Sugerir "cancelar Mercado"
    // seria absurdo; sugerir gastar 15% menos e acionavel. Isto e a trava que
    // nao depende de acertar o nome do lancamento.
    const comprimivel = e.categorySlug !== null && NEVER_CANCEL_CATEGORIES.has(e.categorySlug)
    const kind: Candidate['kind'] = comprimivel ? 'reduce' : 'cancel'
    const savingCents = comprimivel ? Math.round(e.amountCents * 0.15) : e.amountCents

    if (savingCents < 1000) continue

    const reason = orphan
      ? `sem sinal de uso há ${e.monthsSinceSignal} meses`
      : comprimivel
        ? 'gastar 15% menos, sem cortar'
        : pain <= 2
          ? 'assinatura redundante com o que você já tem'
          : 'cancelamento reversível a qualquer momento'

    out.push({
      ruleId: e.ruleId,
      label: e.label,
      savingCents,
      annualCents: savingCents * 12,
      pain,
      reason,
      score: scoreOf(savingCents, pain),
      kind,
    })
  }

  // Economia por unidade de dor, decrescente.
  return out.sort((a, b) => b.score - a.score || b.savingCents - a.savingCents)
}

export interface PlanProposal {
  targetCents: number
  items: Candidate[]
  totalSavingCents: number
  /** Chegou na meta? Se nao, quanto falta. */
  reached: boolean
  gapCents: number
  /** Quanto sobra em dor: media ponderada dos itens escolhidos. */
  avgPain: number
}

/**
 * Monta o plano para uma meta de economia.
 *
 * Guloso por score: pega os cortes menos dolorosos primeiro, ate a meta. Se
 * nem cortando tudo chega, diz que nao chega em vez de fingir.
 */
export function buildPlan(expenses: Expense[], targetCents: number): PlanProposal {
  const candidates = proposeCandidates(expenses)
  const chosen: Candidate[] = []
  let total = 0

  for (const c of candidates) {
    if (total >= targetCents) break
    chosen.push(c)
    total += c.savingCents
  }

  const avgPain =
    chosen.length > 0 ? chosen.reduce((s, c) => s + c.pain, 0) / chosen.length : 0

  return {
    targetCents,
    items: chosen,
    totalSavingCents: total,
    reached: total >= targetCents,
    gapCents: Math.max(0, targetCents - total),
    avgPain: Number(avgPain.toFixed(1)),
  }
}
