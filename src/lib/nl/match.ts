/**
 * Casamento do que ele escreveu com o que ja estava previsto.
 *
 * Sem isto, "paguei 90 de agua hoje" cria uma despesa NOVA de agua ao lado da
 * conta de agua que ja estava prevista para o dia 6, e o mes passa a ter duas.
 * Casar e o que transforma escrita humana em baixa de previsto.
 *
 * Deterministico de proposito: a LLM ja fez a parte dela (dizer "agua"), e
 * daqui pra frente e busca em texto, nao geracao.
 */

export interface Candidate {
  ruleId: string
  label: string
  expectedCents: number
  dueDate: string
  categorySlug: string | null
}

export interface Match {
  candidate: Candidate
  score: number
  reasons: string[]
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Distancia de Levenshtein, para tolerar typo ("netflx" -> "netflix"). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    prev = [...curr] as number[]
  }
  return prev[b.length]!
}

/**
 * Pontua o quanto o texto dele casa com um lancamento previsto.
 *
 * Peso maior no nome do que no valor: ele escreve "agua" e o valor da conta
 * muda todo mes, entao o nome e o sinal forte e o valor e confirmacao.
 */
export function scoreCandidate(
  labelHint: string,
  amountCents: number | null,
  date: string,
  c: Candidate,
): Match {
  const hint = normalize(labelHint)
  const label = normalize(c.label)
  const reasons: string[] = []
  let score = 0

  if (label === hint) {
    score += 0.6
    reasons.push('nome identico')
  } else if (label.includes(hint) || hint.includes(label)) {
    score += 0.45
    reasons.push('nome contido')
  } else {
    // Tolera typo proporcional ao tamanho da palavra.
    const dist = levenshtein(hint, label)
    const tolerance = Math.max(1, Math.floor(Math.max(hint.length, label.length) * 0.25))
    if (dist <= tolerance) {
      score += 0.35
      reasons.push(`nome parecido (distancia ${dist})`)
    } else {
      // Alguma palavra em comum? "conta de agua" vs "agua".
      const hintWords = new Set(hint.split(' ').filter((w) => w.length > 2))
      const labelWords = label.split(' ').filter((w) => w.length > 2)
      const shared = labelWords.filter((w) => hintWords.has(w))
      if (shared.length > 0) {
        score += 0.25
        reasons.push(`palavra em comum: ${shared.join(', ')}`)
      }
    }
  }

  if (score === 0) return { candidate: c, score: 0, reasons: ['nome nao bate'] }

  // Valor: confirma, nao decide.
  if (amountCents !== null && c.expectedCents > 0) {
    const delta = Math.abs(amountCents - c.expectedCents) / c.expectedCents
    if (delta < 0.01) {
      score += 0.3
      reasons.push('valor exato')
    } else if (delta <= 0.25) {
      score += 0.15
      reasons.push(`valor proximo (${(delta * 100).toFixed(0)}% de diferenca)`)
    } else {
      reasons.push(`valor destoa (${(delta * 100).toFixed(0)}%)`)
    }
  }

  // Proximidade de data: uma conta paga perto do vencimento e a mesma conta.
  const days = Math.abs(daysBetween(date, c.dueDate))
  if (days <= 3) {
    score += 0.15
    reasons.push('perto do vencimento')
  } else if (days <= 10) {
    score += 0.05
  }

  return { candidate: c, score: Math.min(score, 1), reasons }
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number]
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)
  return Math.round(ms / 86_400_000)
}

export interface MatchDecision {
  /** Casou com confianca: baixa o previsto. */
  matched: Match | null
  /** Ambiguo: pergunta antes de gravar. */
  alternatives: Match[]
  /** Nao casou com nada: e lancamento novo. */
  isNew: boolean
}

/**
 * Decide entre baixar o previsto, perguntar, ou criar novo.
 *
 * Os limiares sao conservadores de proposito: em caso de duvida, perguntar
 * custa uma interacao; casar errado corrompe o historico em silencio.
 */
export function decideMatch(
  labelHint: string,
  amountCents: number | null,
  date: string,
  candidates: Candidate[],
  opts: { acceptAt?: number; askAt?: number } = {},
): MatchDecision {
  const { acceptAt = 0.7, askAt = 0.4 } = opts

  const scored = candidates
    .map((c) => scoreCandidate(labelHint, amountCents, date, c))
    .filter((m) => m.score >= askAt)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { matched: null, alternatives: [], isNew: true }

  const best = scored[0]!
  const runnerUp = scored[1]

  // Dois candidatos empatados: ele tem dois "Cartao Joao Caixa". Pergunte.
  if (runnerUp && best.score - runnerUp.score < 0.1) {
    return { matched: null, alternatives: scored.slice(0, 3), isNew: false }
  }

  if (best.score >= acceptAt) return { matched: best, alternatives: [], isNew: false }

  return { matched: null, alternatives: scored.slice(0, 3), isNew: false }
}
