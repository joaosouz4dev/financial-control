import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Auditoria de contraste sobre os tokens, direto do CSS.
 *
 * Isto existe porque contraste ruim e invisivel para quem escreve o CSS: o
 * texto "aparece" na tela do autor e reprova para quem enxerga menos. Rodar
 * como teste impede que um ajuste de paleta reintroduza o problema.
 */

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')

function tokensOf(selector: string): Record<string, string> {
  // Pega o bloco do seletor e extrai os pares --token: valor.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's')
  const block = css.match(re)?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]!] = m[2]!
  }
  return out
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)]
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
}

const light = tokensOf(":root[data-theme='light']")
const dark = tokensOf(":root[data-theme='dark']")

const AA_TEXT = 4.5
const AA_UI = 3.0

describe.each([
  ['claro', light],
  ['escuro', dark],
])('contraste WCAG AA no tema %s', (_name, t) => {
  it('texto principal sobre o fundo', () => {
    expect(contrast(t['--ink']!, t['--bg']!)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('texto secundário sobre o fundo', () => {
    expect(contrast(t['--ink-soft']!, t['--bg']!)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('texto terciário sobre o fundo e sobre card', () => {
    expect(contrast(t['--ink-faint']!, t['--bg']!)).toBeGreaterThanOrEqual(AA_TEXT)
    expect(contrast(t['--ink-faint']!, t['--bg-elevated']!)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('texto sobre o card roxo de destaque', () => {
    expect(contrast(t['--brand-ink']!, t['--brand']!)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(['--danger', '--warn', '--ok'])('cor semântica %s sobre card', (token) => {
    expect(contrast(t[token]!, t['--bg-elevated']!)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('badge de insight: mint-ink sobre mint-subtle', () => {
    expect(contrast(t['--mint-ink']!, t['--mint-subtle']!)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('acento como elemento de UI', () => {
    expect(contrast(t['--brand']!, t['--bg']!)).toBeGreaterThanOrEqual(AA_UI)
  })
})

describe('estrutura do tema', () => {
  it('define os dois temas por data-theme, vencendo a media query', () => {
    expect(Object.keys(light).length).toBeGreaterThan(10)
    expect(Object.keys(dark).length).toBeGreaterThan(10)
  })

  it('os dois temas declaram exatamente os mesmos tokens', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
  })

  it('respeita prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion')
  })
})
