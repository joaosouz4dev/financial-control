import Decimal from 'decimal.js'

/**
 * Avaliador de aritmetica para os valores que vem da planilha e da escrita
 * humana: '=4*550', '=(60*5.1)+(60*5.1)*0.1', '=2.86*6.5'.
 *
 * Nunca eval(): isto roda sobre texto que vem de arquivo e de LLM.
 * Decimal.js e nao float: 0.1+0.2 precisa dar 0.3 num app de dinheiro.
 */

type Token =
  | { t: 'num'; v: Decimal }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: 'lparen' }
  | { t: 'rparen' }

export class FormulaError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const s = input.trim()

  while (i < s.length) {
    const c = s[i]!

    if (c === ' ') {
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ t: 'lparen' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ t: 'rparen' })
      i++
      continue
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ t: 'op', v: c })
      i++
      continue
    }
    if (/[\d.,]/.test(c)) {
      let j = i
      while (j < s.length && /[\d.,]/.test(s[j]!)) j++
      const raw = s.slice(i, j)
      tokens.push({ t: 'num', v: new Decimal(normalizeNumber(raw)) })
      i = j
      continue
    }
    throw new FormulaError(`Caractere invalido na formula: ${c!} (em "${input}")`)
  }
  return tokens
}

/**
 * Normaliza numero pt-BR e en-US.
 * '1.850,50' -> 1850.50 | '5.1' -> 5.1 | '59,90' -> 59.90 | '1,234.56' -> 1234.56
 */
export function normalizeNumber(raw: string): string {
  let s = raw.trim()
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // O ultimo separador que aparece e o decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.') // pt-BR: 1.850,50
    } else {
      s = s.replace(/,/g, '') // en-US: 1,234.56
    }
  } else if (hasComma) {
    const parts = s.split(',')
    // '1,234' e ambiguo. Tres digitos apos a virgula = milhar; senao decimal.
    if (parts.length === 2 && parts[1]!.length === 3 && parts[0]!.length <= 3) {
      s = s.replace(',', '') // 1,234 -> 1234
    } else {
      s = s.replace(',', '.') // 59,90 -> 59.90
    }
  }
  // So ponto: deixa como esta. '5.1' e decimal, e '1.850' seria ambiguo,
  // mas a planilha nunca escreve milhar com ponto sem decimal.
  return s
}

/** Parser recursivo-descendente. Precedencia: * / antes de + -. */
function parse(tokens: Token[]): Decimal {
  let pos = 0

  function peek(): Token | undefined {
    return tokens[pos]
  }

  function expr(): Decimal {
    let left = term()
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        pos++
        const right = term()
        left = t.v === '+' ? left.plus(right) : left.minus(right)
      } else {
        return left
      }
    }
  }

  function term(): Decimal {
    let left = unary()
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        pos++
        const right = unary()
        if (t.v === '/' && right.isZero()) throw new FormulaError('Divisao por zero')
        left = t.v === '*' ? left.times(right) : left.div(right)
      } else {
        return left
      }
    }
  }

  function unary(): Decimal {
    const t = peek()
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      pos++
      const v = unary()
      return t.v === '-' ? v.negated() : v
    }
    return primary()
  }

  function primary(): Decimal {
    const t = peek()
    if (!t) throw new FormulaError('Formula incompleta')
    if (t.t === 'num') {
      pos++
      return t.v
    }
    if (t.t === 'lparen') {
      pos++
      const v = expr()
      const close = peek()
      if (close?.t !== 'rparen') throw new FormulaError('Parentese nao fechado')
      pos++
      return v
    }
    throw new FormulaError(`Token inesperado: ${t.t}`)
  }

  const result = expr()
  if (pos !== tokens.length) throw new FormulaError('Sobrou token nao consumido')
  return result
}

/** Avalia e devolve Decimal em unidade monetaria (reais, nao centavos). */
export function evaluateFormula(input: string): Decimal {
  const body = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim()
  if (!body) throw new FormulaError('Formula vazia')
  return parse(tokenize(body))
}

/** Avalia e converte para centavos, arredondando meio-para-cima. */
export function evaluateToCents(input: string): number {
  return evaluateFormula(input).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
}
