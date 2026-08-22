import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '@/db'

/**
 * Funde regras de recorrencia duplicadas apenas por caixa do label.
 *
 * A planilha alternava a caixa da mesma linha ('Van Zaya' e 'van zaya'), e o
 * upsert do import comparava o label cru: cada variacao virou uma regra, com
 * sua propria serie de ocorrencias futuras. O resultado era compromisso dobrado
 * na projecao de fluxo de caixa. A causa esta corrigida em lib/import/persist.ts;
 * este script limpa o passivo que ficou no banco.
 *
 * Sobrevivente = a regra com mais transacoes reais apontando para ela, porque
 * e a que carrega o historico e os valores atuais. Empate cai na mais antiga.
 *
 * Roda em dry-run por padrao. Para gravar: --apply
 */

const TARGETS = [
  'aparelho tauana',
  'van zaya',
  'lanche final de semana',
  'cartão joão caixa',
  'cartão joão caixa #2',
]

const apply = process.argv.includes('--apply')
const brl = (c: number | string) => `R$ ${(Number(c) / 100).toFixed(2)}`

async function main() {
  const res = await db.execute(sql`
    select r.id, r.label, lower(trim(r.label)) as norm, r.context_id,
           r.starts_on, r.category_id, r.amount_cents, r.day_of_month,
           (select count(*) from transactions t where t.rule_id = r.id) as txs
    from recurrence_rules r
    where lower(trim(r.label)) in (
      'aparelho tauana','van zaya','lanche final de semana',
      'cartão joão caixa','cartão joão caixa #2'
    )
    order by lower(trim(r.label)), r.starts_on
  `)
  const rows = ((res as any).rows ?? res) as any[]

  const groups = new Map<string, any[]>()
  for (const r of rows) {
    const key = `${r.context_id}::${r.norm}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  console.log(apply ? '=== APLICANDO ===' : '=== DRY-RUN (nada sera gravado) ===')

  let totalOccRemovidas = 0
  let totalTxRepontadas = 0

  for (const [key, rules] of groups) {
    const norm = key.split('::')[1]

    // Guarda: so funde o que e realmente o mesmo label normalizado. '#2' tem
    // chave propria, entao os dois cartoes nunca se encontram aqui.
    const distinct = new Set(rules.map((r) => r.norm))
    if (distinct.size !== 1) {
      console.log(`\n!! ${norm}: grupo heterogeneo, PULANDO`)
      continue
    }
    if (rules.length < 2) {
      console.log(`\n-- ${norm}: sem duplicata, pulando`)
      continue
    }

    const sorted = [...rules].sort(
      (a, b) => Number(b.txs) - Number(a.txs) || String(a.starts_on).localeCompare(String(b.starts_on)),
    )
    const keep = sorted[0]!
    const drop = sorted.slice(1)

    console.log(`\n### ${norm}`)
    console.log(`  MANTEM  ${keep.id.slice(0, 8)} "${keep.label}" starts=${keep.starts_on} txs=${keep.txs} valor=${brl(keep.amount_cents)}`)

    for (const d of drop) {
      const occAbertas = await db.execute(sql`
        select count(*) as n, coalesce(sum(expected_cents), 0) as cents
        from recurrence_occurrences
        where rule_id = ${d.id} and transaction_id is null and skipped_at is null
      `)
      const oa = (((occAbertas as any).rows ?? occAbertas) as any[])[0]!
      const occRealizadas = await db.execute(sql`
        select count(*) as n from recurrence_occurrences
        where rule_id = ${d.id} and transaction_id is not null
      `)
      const orl = (((occRealizadas as any).rows ?? occRealizadas) as any[])[0]!

      console.log(`  FUNDE   ${d.id.slice(0, 8)} "${d.label}" starts=${d.starts_on} txs=${d.txs} valor=${brl(d.amount_cents)}`)
      console.log(`          ${d.txs} transacao(oes) repontada(s) para a mantida`)
      console.log(`          ${orl.n} ocorrencia(s) realizada(s) repontada(s)`)
      console.log(`          ${oa.n} ocorrencia(s) futura(s) em aberto removida(s) (${brl(oa.cents)})`)

      totalTxRepontadas += Number(d.txs)
      totalOccRemovidas += Number(oa.n)

      if (apply) {
        await db.transaction(async (tx) => {
          // Historico primeiro: transacoes reais nunca podem ficar orfas.
          await tx.execute(sql`update transactions set rule_id = ${keep.id} where rule_id = ${d.id}`)

          // Ocorrencia realizada carrega estado (o que foi pago). Migra, a nao
          // ser que a mantida ja tenha uma no mesmo dueDate: o unique
          // (rule, due_date) rejeitaria, e nesse caso a da mantida prevalece.
          await tx.execute(sql`
            update recurrence_occurrences o set rule_id = ${keep.id}
            where o.rule_id = ${d.id} and o.transaction_id is not null
              and not exists (
                select 1 from recurrence_occurrences k
                where k.rule_id = ${keep.id} and k.due_date = o.due_date
              )
          `)

          // Previsao duplicada: some. A mantida ja projeta essas mesmas datas.
          await tx.execute(sql`
            delete from recurrence_occurrences
            where rule_id = ${d.id} and transaction_id is null and skipped_at is null
          `)

          // Categoria da duplicada preenche buraco da mantida.
          if (!keep.category_id && d.category_id) {
            await tx.execute(sql`update recurrence_rules set category_id = ${d.category_id} where id = ${keep.id}`)
            console.log(`          categoria herdada da fundida`)
          }

          const resto = await tx.execute(sql`
            select count(*) as n from recurrence_occurrences where rule_id = ${d.id}
          `)
          const n = Number((((resto as any).rows ?? resto) as any[])[0]!.n)
          if (n === 0) {
            await tx.execute(sql`delete from recurrence_rules where id = ${d.id}`)
            console.log(`          regra removida`)
          } else {
            // Sobrou ocorrencia com estado que nao pode migrar: desativa em vez
            // de apagar, senao o cascade levaria o estado junto.
            await tx.execute(sql`update recurrence_rules set active = false where id = ${d.id}`)
            console.log(`          regra DESATIVADA (${n} ocorrencia(s) preservada(s))`)
          }
        })
      }
    }
  }

  console.log(`\n--- Resumo ---`)
  console.log(`transacoes repontadas: ${totalTxRepontadas}`)
  console.log(`ocorrencias futuras removidas: ${totalOccRemovidas}`)
  if (!apply) console.log(`\nNada foi gravado. Rode com --apply para efetivar.`)
}

await main()
process.exit(0)
