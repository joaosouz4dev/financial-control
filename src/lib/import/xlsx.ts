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

/**
 * Le o dia de pagamento/vencimento respeitando a era da planilha.
 *
 * 2025/2026: a celula ja e o dia do mes (numero). 2022/2023: e uma DATA
 * (datetime), e o dia sai de getDate(). Ler a data como numero daria o serial
 * do Excel (ex 45000), que viraria uma data absurda.
 */
function readDay(row: ExcelJS.Row, col: number, kind: 'day' | 'date'): number | null {
  if (col === 0) return null
  const cell = row.getCell(col)
  const v = cell.value
  if (v === null || v === undefined || v === '') return null

  if (kind === 'date') {
    if (v instanceof Date) return v.getUTCDate()
    // Formula/resultado que resolve para data.
    if (typeof v === 'object' && 'result' in v && (v as any).result instanceof Date) {
      return ((v as any).result as Date).getUTCDate()
    }
    return null
  }

  return cellNumber(cell)
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
  /**
   * Como ler a coluna "paid": em 2022/2023 e uma DATA (datetime), em 2025/2026
   * e o DIA do mes (numero). O parser precisa saber qual, senao le a data como
   * dia 45000 (serial do Excel).
   */
  paidKind: 'day' | 'date'
}

/**
 * O layout mudou 3 vezes em 4 anos. Detecta a era pelos cabecalhos.
 *
 * - 2026: "CONTROLE DE DESPESAS" / "CONTROLE DE RECEITAS" (o formato atual).
 * - 2025: "Despesas" + "Receita", com Pagamento/Vencimento como dia do mes.
 * - 2023: "Despesas" + "Categorias" + "Renda Extra", data como datetime.
 * - 2022: "Despesas" + "Renda Extra", sem categoria, data como datetime.
 *
 * A funcao tenta o formato novo primeiro (detectModern) e cai nos antigos
 * (detectLegacy) so quando o novo nao casa.
 */
function detectLayout(ws: ExcelJS.Worksheet): Layout {
  return detectModern(ws) ?? detectLegacy(ws)
}

function detectModern(ws: ExcelJS.Worksheet): Layout | null {
  const layout: Layout = {
    expense: null,
    income: null,
    goals: null,
    headerRow: 1,
    paidKind: 'day',
  }

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
      return layout
    }
  }

  return null
}

/**
 * Formatos antigos (2022-2025). O titulo e "Despesas" (nao "CONTROLE DE
 * DESPESAS"), e a estrutura varia. Ancora no cabecalho "Despesas" e detecta as
 * colunas ao redor pela presenca de "Categorias" e pelo tipo da coluna de data.
 */
function detectLegacy(ws: ExcelJS.Worksheet): Layout {
  const layout: Layout = {
    expense: null,
    income: null,
    goals: null,
    headerRow: 1,
    paidKind: 'date',
  }

  const header = ws.getRow(1)
  let despCol = 0
  let rendaCol = 0 // "Renda Extra" (2022/2023) ou "Receita" (2025)
  let catCol = 0
  let objetivoCol = 0

  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = norm(cellText(cell))
    if (!despCol && t === 'DESPESAS') despCol = col
    if (!rendaCol && (t === 'RENDA EXTRA' || t === 'RECEITA')) rendaCol = col
    if (!catCol && (t === 'CATEGORIAS' || t === 'CATEGORIA')) catCol = col
    if (!objetivoCol && t === 'OBJETIVO') objetivoCol = col
  })

  if (!despCol) {
    throw new Error(
      `nao reconheci o layout: nem "CONTROLE DE DESPESAS" (novo) nem "Despesas" (antigo)`,
    )
  }

  // 2025 tem Pagamento/Vencimento como colunas proprias (dia do mes).
  const paidHdr = colOfIn(header, ['PAGAMENTO'], despCol, 6)
  const dueHdr = colOfIn(header, ['VENCIMENTO'], despCol, 6)
  const is2025 = paidHdr !== null && dueHdr !== null

  if (is2025) {
    // A=valor B=desc C=Pagamento(dia) D=Vencimento(dia) E=Categorias
    layout.paidKind = 'day'
    layout.expense = {
      amount: despCol,
      desc: despCol + 1,
      paid: paidHdr!,
      due: dueHdr!,
      cat: catCol || despCol + 4,
    }
    if (rendaCol) {
      const ipaid = colOfIn(header, ['PAGAMENTO'], rendaCol, 5)
      const idue = colOfIn(header, ['VENCIMENTO'], rendaCol, 5)
      layout.income = {
        amount: rendaCol,
        desc: rendaCol + 1,
        paid: ipaid ?? rendaCol + 2,
        due: idue ?? rendaCol + 3,
      }
    }
  } else {
    // 2022/2023: A=valor B=desc C=data(datetime) [D=Categorias em 2023]
    layout.paidKind = 'date'
    layout.expense = {
      amount: despCol,
      desc: despCol + 1,
      paid: despCol + 2, // coluna de data
      due: despCol + 2, // sem vencimento separado: usa a mesma data
      cat: catCol || 0, // 2022 nao tem categoria; 0 = ignora
    }
    if (rendaCol) {
      // Renda extra: valor + descricao, sem data de pagamento estruturada.
      layout.income = {
        amount: rendaCol,
        desc: rendaCol + 1,
        paid: 0,
        due: 0,
      }
    }
  }

  // Metas: bloco Objetivo com cabecalho "%" nas linhas seguintes.
  if (objetivoCol) {
    for (let gr = 1; gr <= Math.min(3, ws.rowCount); gr++) {
      const grow = ws.getRow(gr)
      for (let c = objetivoCol; c < objetivoCol + 5; c++) {
        if (norm(cellText(grow.getCell(c))) === '%') {
          layout.goals = { cat: c - 1, pct: c }
          break
        }
      }
      if (layout.goals) break
    }
  }

  return layout
}

/** Acha a coluna cujo cabecalho bate um dos labels, numa janela. */
function colOfIn(
  row: ExcelJS.Row,
  labels: string[],
  from: number,
  span: number,
): number | null {
  for (let c = from; c < from + span; c++) {
    const t = norm(cellText(row.getCell(c)))
    if (labels.some((l) => t === l)) return c
  }
  return null
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
            // cat=0 significa "esta era nao tem categoria" (2022).
            categoryRaw: layout.expense.cat > 0 ? cellText(row.getCell(layout.expense.cat)) || null : null,
            paidDay: readDay(row, layout.expense.paid, layout.paidKind),
            dueDay: readDay(row, layout.expense.due, layout.paidKind),
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
            paidDay: readDay(row, layout.income.paid, layout.paidKind),
            dueDay: readDay(row, layout.income.due, layout.paidKind),
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
