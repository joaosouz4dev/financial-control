/**
 * Paleta das categorias.
 *
 * Sao slots fixos, atribuidos em ordem e nunca ciclados: a cor segue a
 * categoria, nao a posicao dela numa lista filtrada. Se o Joao arquivar
 * "Lazer", as outras nao se repintam.
 *
 * Cada slot tem um passo proprio para o claro e para o escuro. O dark nao e um
 * flip do light: os dois foram escolhidos contra a sua propria superficie e
 * validados (banda de luminosidade, piso de croma, separacao para daltonismo e
 * contraste) com o validador da skill de dataviz.
 *
 * No claro, tres passos ficam abaixo de 3:1 contra o fundo. Isso e aceitavel
 * aqui porque a cor nunca carrega sozinha a identidade: o nome da categoria
 * aparece sempre ao lado do ponto colorido.
 */

export interface PaletteSlot {
  /** Chave guardada no banco, nao o hex: trocar a paleta nao migra dado. */
  key: string
  name: string
  light: string
  dark: string
}

export const CATEGORY_PALETTE: PaletteSlot[] = [
  { key: 'blue', name: 'Azul', light: '#2a78d6', dark: '#3987e5' },
  { key: 'orange', name: 'Laranja', light: '#eb6834', dark: '#d95926' },
  { key: 'aqua', name: 'Verde-água', light: '#1baf7a', dark: '#199e70' },
  { key: 'yellow', name: 'Amarelo', light: '#eda100', dark: '#c98500' },
  { key: 'magenta', name: 'Magenta', light: '#e87ba4', dark: '#d55181' },
  { key: 'green', name: 'Verde', light: '#008300', dark: '#008300' },
  { key: 'violet', name: 'Violeta', light: '#4a3aa7', dark: '#9085e9' },
]

const BY_KEY = new Map(CATEGORY_PALETTE.map((s) => [s.key, s]))

/** Sem categoria, ou cor desconhecida: cinza declarado, nao um hue inventado. */
export const NEUTRAL_SLOT: PaletteSlot = {
  key: 'neutral',
  name: 'Cinza',
  light: '#6b7280',
  dark: '#9ca3af',
}

export function slotByKey(key: string | null | undefined): PaletteSlot {
  if (!key) return NEUTRAL_SLOT
  return BY_KEY.get(key) ?? NEUTRAL_SLOT
}

/**
 * O proximo slot livre, em ordem fixa.
 *
 * Passado o fim da paleta, cai no cinza em vez de gerar um hue novo: uma cor
 * inventada nao passaria pelas checagens de daltonismo contra as existentes.
 */
export function nextFreeSlot(usedKeys: Iterable<string | null>): PaletteSlot {
  const used = new Set([...usedKeys].filter((k): k is string => !!k))
  return CATEGORY_PALETTE.find((s) => !used.has(s.key)) ?? NEUTRAL_SLOT
}

/**
 * Resolve o par (claro, escuro) de uma categoria.
 *
 * Aceita tanto a chave de slot quanto um hex cru, porque as categorias antigas
 * foram semeadas com hex direto na coluna `color`.
 */
export function resolveColors(
  color: string | null,
  colorDark: string | null,
): { light: string; dark: string } {
  if (color?.startsWith('#')) {
    return { light: color, dark: colorDark ?? color }
  }
  const slot = slotByKey(color)
  return { light: slot.light, dark: slot.dark }
}

/**
 * Slug a partir do nome: sem acento, sem espaco, estavel.
 *
 * Fica aqui, e nao na rota, porque a rota importa `auth` e arrasta o runtime do
 * Next junto: uma funcao de string nao deveria precisar disso para ser testada.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
