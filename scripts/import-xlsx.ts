import 'dotenv/config'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { seed } from '../src/db/seed'
import { importWorkbook } from '../src/lib/import/persist'

/**
 * Importa todas as planilhas de /planilhas (ou os arquivos passados por
 * argumento). Idempotente: rodar duas vezes nao duplica.
 *
 *   pnpm import:xlsx
 *   pnpm import:xlsx "Controle Financeiro 07_2026.xlsx"
 */

const DIR = path.join(process.cwd(), 'planilhas')

async function main() {
  if (!existsSync(DIR)) {
    console.error(`Diretorio nao encontrado: ${DIR}`)
    process.exit(1)
  }

  console.log('Seed de contextos, categorias e metas...')
  const s = await seed()
  console.log(`  ${s.contexts} contextos, ${s.categories} categorias, ${s.goals} metas\n`)

  const args = process.argv.slice(2)
  const files = args.length
    ? args
    : readdirSync(DIR)
        .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
        .sort()

  if (files.length === 0) {
    console.error('Nenhum .xlsx encontrado em /planilhas')
    process.exit(1)
  }

  console.log(`Importando ${files.length} arquivo(s):\n`)
  let totalIn = 0
  let totalSkip = 0
  let totalRules = 0
  const failures: string[] = []

  for (const f of files) {
    try {
      const r = await importWorkbook(path.join(DIR, f), f)
      totalIn += r.inserted
      totalSkip += r.skipped
      totalRules += r.rulesCreated
      const warn = r.warnings > 0 ? `  ${r.warnings} avisos` : ''
      console.log(
        `  ${r.period}  ${String(r.inserted).padStart(3)} novos  ${String(r.skipped).padStart(3)} ja existiam  ${String(r.rulesCreated).padStart(2)} regras${warn}`,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push(`${f}: ${msg}`)
      console.log(`  FALHOU  ${f}`)
    }
  }

  console.log(`\n${totalIn} lancamentos, ${totalSkip} ignorados, ${totalRules} regras criadas`)

  if (failures.length) {
    console.log(`\n${failures.length} arquivo(s) nao importados:`)
    for (const f of failures) console.log(`  ${f}`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
