import ExcelJS from 'exceljs'
import { evaluateToCents, FormulaError } from '../formula/evaluate'

/**
 * Importador das planilhas "Controle Financeiro MM_YYYY.xlsx".
 *
 * Tolerante por design: o layout mudou ao longo dos anos, entao as colunas sao
 * descobertas pelos cabecalhos em vez de fixadas em A/B/C. O que nao der para
 * ler vira warning com numero de linha, nunca um silencio.
 */

export interface ParsedEntry {
  kind: 'expense' | 'income'
  amountCents: number
  amountExpression: string | null
  description: string
  categoryRaw: string | null
  paidDay: number | null
  dueDay: number | null
  row: number
  /** 'Parcela Carro 06/25' -> {current:6,total:25} */
  installment: { current: number; total: number } | null
}

export interface ParsedGoal {
  categoryRaw: string
  pct: number
}

export interface ParseWarning {
  row: number
  column: string
  value: string
  reason: string
}

export interface ParsedSheet {
  filename: string
  period: { year: number; month: number } | null
  entries: ParsedEntry[]
  goals: ParsedGoal[]
  warnings: ParseWarning[]
  stats: { expenses: number; incomes: number; totalExpenseCents: number; totalIncomeCents: number }
}

/** 'Controle Financeiro 07_2026.xlsx' -> {year:2026, month:7} */
export function parsePeriodFromFilename(filename: string): { year: number; month: number } | null {
  const m = filename.match(/(\d{1,2})[_\-.](\d{4})/)
  if (m) {
    const month = Number(m[1])
    const year = Number(m[2])
    if (month >= 1 && month <= 12) return { year, month }
  }
  const m2 = filename.match(/(\d{4})[_\-.](\d{1,2})/)
  if (m2) {
    const year = Number(m2[1])
    const month = Number(m2[2])
    if (month >= 1 && month <= 12) return { year, month }
  }
  return null
}

/**
 * 'Parcela Carro 06/25' -> {current:6,total:25}
 * 'Marmore 5/6' -> {current:5,total:6}
 * Ignora datas: 'Aluguel 12/2025' nao e parcelamento.
 */
export function parseInstallment(description: string): { current: number; total: number } | null {
  const m = description.match(/(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/)
  if (!m) return null
  const current = Number(m[1])
  const total = Number(m[2])
  if (total > 120 || current > total || current < 1 || total < 2) return null
  return { current, total }
}

/**
 * Le uma celula de valor: numero, formula ('=2*75'), ou texto ('R$ 354,20').
 * A planilha usa os tres.
 */
export function readAmountCell(cell: ExcelJS.Cell): { cents: number; expression: string | null } {
  const v = cell.value

  if (v === null || v === undefined || v === '') {
    throw new FormulaError('celula vazia')
  }

  if (typeof v === 'number') {
    return { cents: Math.round(v * 100), expression: null }
  }

  // Formula: ExcelJS entrega {formula, result}. A formula e a intencao.
  if (typeof v === 'object' && 'formula' in v) {
    const f = (v as ExcelJS.CellFormulaValue).formula
    const expr = `=${f}`
    try {
      return { cents: evaluateToCents(expr), expression: expr }
    } catch {
      // Nao avaliou (funcao do Excel?). Usa o resultado cacheado se houver.
      const result = (v as ExcelJS.CellFormulaValue).result
      if (typeof result === 'number') return { cents: Math.round(result * 100), expression: expr }
      throw new FormulaError(`formula nao avaliavel: ${expr}`)
    }
  }

  if (typeof v === 'string') {
    // 'R$ 354,20' -> '354,20'
    const cleaned = v.replace(/R\$\s*/gi, '').trim()
    if (!cleaned) throw new FormulaError('celula vazia')
    const cents = evaluateToCents(cleaned)
    return { cents, expression: cleaned.startsWith('=') ? cleaned : null }
  }

  throw new FormulaError(`tipo de celula nao suportado: ${typeof v}`)
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'result' in v) return String((v as any).result ?? '').trim()
  if (typeof v === 'object' && 'richText' in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('').trim()
  }
  return String(v).trim()
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value
  if (typeof v === 'number') return v
  if (typeof v === 'object' && v && 'result' in v && typeof (v as any).result === 'number') {
    return (v as any).result
  }
  const t = cellText(cell)
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
}

/**
 * Descobre onde comecam os blocos de despesa e receita procurando os
 * cabecalhos, em vez de assumir A/B/C e G/H/I.
 */
interface Layout {
  expense: { amount: number; desc: number; paid: number; due: number; cat: number } | null
  income: { amount: number; desc: number; paid: number; due: number } | null
  goals: { cat: number; pct: number } | null
  headerRow: number
}

function detectLayout(ws: ExcelJS.Worksheet): Layout {
  const layout: Layout = { expense: null, income: null, goals: null, headerRow: 1 }

  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r)
    let expenseCol = 0
    let incomeCol = 0
    let goalCol = 0

    // Titulos vivem em celulas mescladas e o ExcelJS repete o texto em toda a
    // mescla. So a PRIMEIRA coluna e a real: sobrescrever desloca tudo.
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const t = norm(cellText(cell))
      if (!expenseCol && t.includes('CONTROLE DE DESPESA')) expenseCol = col
      if (!incomeCol && t.includes('CONTROLE DE RECEITA')) incomeCol = col
      if (!goalCol && t.includes('OBJETIVO')) goalCol = col
    })

    if (expenseCol || incomeCol) {
      layout.headerRow = r

      // Os titulos ficam em celulas mescladas (A1:B1), e o ExcelJS espelha o
      // texto em toda a mescla. Entao ancorar no titulo desloca as colunas.
      // Os cabecalhos reais (PAGAMENTO/VENCIMENTO) nao sao mesclados.
      const colOf = (labels: string[], from: number, span = 6): number | null => {
        for (let c = from; c < from + span; c++) {
          const t = norm(cellText(row.getCell(c)))
          if (labels.some((l) => t === l)) return c
        }
        return null
      }

      if (expenseCol) {
        const paid = colOf(['PAGAMENTO'], expenseCol)
        const due = colOf(['VENCIMENTO'], expenseCol)
        const cat = colOf(['CATEGORIAS', 'CATEGORIA'], expenseCol)
        // Valor e descricao vem antes de PAGAMENTO: valor = paid-2, desc = paid-1.
        const amount = paid ? paid - 2 : expenseCol
        layout.expense = {
          amount,
          desc: amount + 1,
          paid: paid ?? amount + 2,
          due: due ?? amount + 3,
          cat: cat ?? amount + 4,
        }
      }
      if (incomeCol) {
        const paid = colOf(['PAGAMENTO'], incomeCol)
        const due = colOf(['VENCIMENTO'], incomeCol)
        const amount = paid ? paid - 2 : incomeCol
        layout.income = {
          amount,
          desc: amount + 1,
          paid: paid ?? amount + 2,
          due: due ?? amount + 3,
        }
      }
      if (goalCol) {
        // OBJETIVO e mesclado e seus cabecalhos (CATEGORIAS/%/R$) ficam na
        // linha seguinte, nao na do titulo. Procura o '%' nas proximas linhas.
        for (let gr = r; gr <= Math.min(r + 2, ws.rowCount); gr++) {
          const grow = ws.getRow(gr)
          for (let c = goalCol; c < goalCol + 5; c++) {
            if (norm(cellText(grow.getCell(c))) === '%') {
              layout.goals = { cat: c - 1, pct: c }
              break
            }
          }
          if (layout.goals) break
        }
        if (!layout.goals) layout.goals = { cat: goalCol, pct: goalCol + 1 }
      }
      break
    }
  }

  return layout
}

export async function parseWorkbook(filePath: string, filename: string): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error(`${filename}: nenhuma aba encontrada`)

  const layout = detectLayout(ws)
  const warnings: ParseWarning[] = []
  const entries: ParsedEntry[] = []
  const goals: ParsedGoal[] = []

  if (!layout.expense && !layout.income) {
    throw new Error(
      `${filename}: nao achei os cabecalhos "CONTROLE DE DESPESAS"/"CONTROLE DE RECEITAS"`,
    )
  }

  const start = layout.headerRow + 1
  const end = ws.rowCount

  for (let r = start; r <= end; r++) {
    const row = ws.getRow(r)

    // Despesas
    if (layout.expense) {
      const desc = cellText(row.getCell(layout.expense.desc))
      const amountCell = row.getCell(layout.expense.amount)
      if (desc && amountCell.value !== null && amountCell.value !== undefined) {
        try {
          const { cents, expression } = readAmountCell(amountCell)
          entries.push({
            kind: 'expense',
            amountCents: cents,
            amountExpression: expression,
            description: desc,
            categoryRaw: cellText(row.getCell(layout.expense.cat)) || null,
            paidDay: cellNumber(row.getCell(layout.expense.paid)),
            dueDay: cellNumber(row.getCell(layout.expense.due)),
            row: r,
            installment: parseInstallment(desc),
          })
        } catch (e) {
          warnings.push({
            row: r,
            column: 'despesa',
            value: String(amountCell.value),
            reason: e instanceof Error ? e.message : 'erro ao ler valor',
          })
        }
      }
    }

    // Receitas
    if (layout.income) {
      const desc = cellText(row.getCell(layout.income.desc))
      const amountCell = row.getCell(layout.income.amount)
      if (desc && amountCell.value !== null && amountCell.value !== undefined) {
        try {
          const { cents, expression } = readAmountCell(amountCell)
          entries.push({
            kind: 'income',
            amountCents: cents,
            amountExpression: expression,
            description: desc,
            categoryRaw: null,
            paidDay: cellNumber(row.getCell(layout.income.paid)),
            dueDay: cellNumber(row.getCell(layout.income.due)),
            row: r,
            installment: parseInstallment(desc),
          })
        } catch (e) {
          warnings.push({
            row: r,
            column: 'receita',
            value: String(amountCell.value),
            reason: e instanceof Error ? e.message : 'erro ao ler valor',
          })
        }
      }
    }

    // Metas
    if (layout.goals) {
      const cat = cellText(row.getCell(layout.goals.cat))
      const pct = cellNumber(row.getCell(layout.goals.pct))
      const nc = norm(cat)
      if (cat && pct !== null && nc !== 'TOTAL' && nc !== 'CATEGORIAS') {
        goals.push({ categoryRaw: cat, pct: pct <= 1 ? pct * 100 : pct })
      }
    }
  }

  const expenses = entries.filter((e) => e.kind === 'expense')
  const incomes = entries.filter((e) => e.kind === 'income')

  return {
    filename,
    period: parsePeriodFromFilename(filename),
    entries,
    goals,
    warnings,
    stats: {
      expenses: expenses.length,
      incomes: incomes.length,
      totalExpenseCents: expenses.reduce((s, e) => s + e.amountCents, 0),
      totalIncomeCents: incomes.reduce((s, e) => s + e.amountCents, 0),
    },
  }
}
