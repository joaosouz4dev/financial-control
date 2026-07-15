/**
 * Fatura de cartao varia todo mes por natureza: e a soma de compras, nao um
 * preco. Rotular isso como "preco mudou" gera ruido mensal e treina o usuario
 * a ignorar os insights, que e o pior resultado possivel.
 *
 * O tratamento certo (itemizacao) faz o cartao virar conta e cada compra
 * dentro dela bater na categoria. Ate la, fica fora do detector de preco.
 *
 * Parcelamento tambem sai da deteccao de preco: 'Marmore 5/6' e 'Marmore 4/5'
 * tem valor fixo e a descricao muda todo mes, entao nunca formam serie.
 */
export function isVolatileByNature(description: string): boolean {
  const d = description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  return /\bcart(a|ao)/.test(d) || /\bfatura\b/.test(d) || /\d+\s*\/\s*\d+/.test(d)
}

/** Cartao de credito: vira conta, nao despesa. */
export function looksLikeCreditCard(description: string): boolean {
  const d = description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  return /\bcart(a|ao)/.test(d) || /\bfatura\b/.test(d)
}
