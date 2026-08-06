/**
 * Duas perguntas diferentes sobre o mesmo lancamento. Responder as duas com a
 * mesma funcao foi um bug: o cartao sumia da projecao de fluxo de caixa.
 *
 *   1. "isso entra no detector de PRECO?"      -> isVolatileByNature
 *   2. "isso merece uma REGRA de recorrencia?" -> deservesRecurrence
 *
 * Fatura de cartao responde NAO para a primeira (o valor varia todo mes por
 * natureza, e acusar isso como "preco mudou" gera ruido mensal) e SIM para a
 * segunda (ela vence todo dia 14, e ignorar isso apaga R$ 4 mil por mes do
 * futuro projetado).
 */

function norm(description: string): string {
  return description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Cartao de credito ou fatura. */
export function looksLikeCreditCard(description: string): boolean {
  const d = norm(description)
  return /\bcart(a|ao)/.test(d) || /\bfatura\b/.test(d)
}

/** Tem contador de parcela: "Marmore 5/6", "Parcela Carro 06/25". */
export function hasInstallmentCounter(description: string): boolean {
  return /\d+\s*\/\s*\d+/.test(description)
}

/**
 * Fica FORA do detector de variacao de preco.
 *
 * Fatura de cartao e a soma de compras, nao um preco: rotular a variacao como
 * "preco mudou" treina o usuario a ignorar os insights, que e o pior resultado
 * possivel. Parcelamento tambem sai: o valor e fixo e a descricao muda todo
 * mes, entao nunca forma serie.
 */
export function isVolatileByNature(description: string): boolean {
  return looksLikeCreditCard(description) || hasInstallmentCounter(description)
}

/**
 * Merece uma regra de recorrencia.
 *
 * Quase tudo merece: a fatura do cartao vence todo mes e precisa aparecer no
 * fluxo de caixa futuro, mesmo que o valor varie. O que NAO merece e o gasto
 * avulso, que por definicao nao se repete.
 */
export function deservesRecurrence(description: string, opts: { oneOff?: boolean } = {}): boolean {
  return !opts.oneOff
}
