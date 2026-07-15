import { parseWorkbook } from './import/xlsx'
import type { Tx, Goal } from './month-summary'
import { detectPriceChanges, detectIncomeConcentration, detectCatchAllCategory, type Insight } from './insights/detectors'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Fonte do dashboard enquanto o banco nao esta plugado: le as planilhas reais
 * do diretorio /planilhas. Assim a UI e desenvolvida contra os dados de
 * verdade, nao contra mock que sempre mente.
 */

const DIR = path.join(process.cwd(), 'planilhas')

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Dia da planilha (5, 30) para data ISO, clampando meses curtos. */
function dayToISO(year: number, month: number, day: number | null): string | null {
  if (day === null || day < 1) return null
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const d = Math.min(day, last)
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Fatura de cartao varia todo mes por natureza: e a soma de compras, nao um
 * preco. Rotular isso como "preco mudou" gera ruido mensal e treina o usuario
 * a ignorar os insights, que e o pior resultado possivel.
 *
 * O tratamento certo (Fase 4) e itemizar a fatura: cartao vira conta, e cada
 * compra dentro dela e que bate na categoria. Ate la, fica fora do detector.
 *
 * Parcelamento tambem sai: 'Marmore 5/6' e 'Marmore 4/5' sao regras distintas
 * com valor fixo, e a descricao muda todo mes, entao nunca formam serie.
 */
export function isVolatileByNature(description: string): boolean {
  const d = description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  return /\bcart(a|ao)/.test(d) || /\bfatura\b/.test(d) || /\d+\s*\/\s*\d+/.test(d)
}

export interface MonthData {
  month: string
  txs: Tx[]
  goals: Goal[]
}

export async function loadMonth(file: string): Promise<MonthData | null> {
  const full = path.join(DIR, file)
  if (!existsSync(full)) return null

  const parsed = await parseWorkbook(full, file)
  if (!parsed.period) return null
  const { year, month } = parsed.period
  const monthKey = `${year}-${String(month).padStart(2, '0')}`

  const txs: Tx[] = parsed.entries.map((e, i) => {
    const catName = e.categoryRaw ?? null
    return {
      id: `${monthKey}-${i}`,
      kind: e.kind,
      amountCents: e.amountCents,
      description: e.description,
      categorySlug: catName ? slugify(catName) : null,
      categoryName: catName,
      dueDate: dayToISO(year, month, e.dueDay) ?? `${monthKey}-01`,
      paidAt: dayToISO(year, month, e.paidDay),
      contextSlug: 'pessoal',
    }
  })

  const goals: Goal[] = parsed.goals
    .filter((g) => slugify(g.categoryRaw) !== 'investimento')
    .map((g) => ({
      categorySlug: slugify(g.categoryRaw),
      categoryName: g.categoryRaw,
      pct: g.pct,
    }))

  return { month: monthKey, txs, goals }
}

export async function loadAllMonths(): Promise<MonthData[]> {
  const files = ['Controle Financeiro 06_2026.xlsx', 'Controle Financeiro 07_2026.xlsx']
  const out: MonthData[] = []
  for (const f of files) {
    const m = await loadMonth(f)
    if (m) out.push(m)
  }
  return out.sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Roda os detectores sobre os meses carregados. Comparar meses e exatamente
 * o que a planilha nao consegue fazer consigo mesma.
 */
export function runDetectors(months: MonthData[]): Insight[] {
  if (months.length === 0) return []
  const insights: Insight[] = []

  // Variacao de preco: casa lancamentos pela descricao entre meses.
  const points = months.flatMap((m) =>
    m.txs
      .filter((t) => t.kind === 'expense' && !isVolatileByNature(t.description))
      .map((t) => ({
        ruleId: slugify(t.description),
        label: t.description,
        month: m.month,
        amountCents: t.amountCents,
      })),
  )
  // Descricao duplicada no mesmo mes (dois "Cartão João Caixa") quebraria a
  // serie: mantem so a primeira ocorrencia por (regra, mes).
  const seen = new Set<string>()
  const unique = points.filter((p) => {
    const k = `${p.ruleId}:${p.month}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  insights.push(...detectPriceChanges(unique))

  const last = months.at(-1)!
  const incomeSources = last.txs
    .filter((t) => t.kind === 'income')
    .map((t) => ({ label: t.description, amountCents: t.amountCents }))
  insights.push(...detectIncomeConcentration(last.month, incomeSources))

  const totalIncome = incomeSources.reduce((s, x) => s + x.amountCents, 0)
  const outros = last.txs.filter((t) => t.kind === 'expense' && t.categorySlug === 'outros')
  if (outros.length > 0) {
    insights.push(
      ...detectCatchAllCategory(
        last.month,
        'Outros',
        'outros',
        outros.length,
        outros.reduce((s, t) => s + t.amountCents, 0),
        totalIncome,
        5,
      ),
    )
  }

  const order = { critical: 0, warn: 1, info: 2 } as const
  return insights.sort((a, b) => order[a.severity] - order[b.severity])
}
