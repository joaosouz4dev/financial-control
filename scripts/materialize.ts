import 'dotenv/config'
import { materializeOccurrences } from '../src/lib/recurrence/materialize'

/**
 * Gera as ocorrencias futuras das regras ativas. Idempotente: pode rodar em
 * cron. Sem isto nao ha futuro para projetar.
 */
async function main() {
  const r = await materializeOccurrences()
  console.log(`Janela: ${r.from} a ${r.to}`)
  console.log(`${r.rulesProcessed} regras -> ${r.occurrencesCreated} ocorrencias novas`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
