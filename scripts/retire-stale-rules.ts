import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { STALE_MONTHS } from '@/lib/recurrence/retire'

/**
 * Encerra regras de recorrencia que pararam de acontecer.
 *
 * O import promove a regra por heuristica sobre a descricao (deservesRecurrence),
 * entao um trabalho avulso de 2022 virou assinatura mensal sem fim: cadence
 * 'monthly' e ends_on null. O gerador cumpre o combinado e produz ocorrencia
 * todo mes, para sempre. O resultado e um mes futuro cheio de previsao nascida
 * de evento que aconteceu uma vez, anos atras.
 *
 * A regra morre quando para de acontecer: sem lancamento real ha STALE_MONTHS,
 * ends_on recebe a data do ultimo lancamento e a geracao para ali. Ocorrencias
 * futuras ainda em aberto (sem transacao, sem skip) somem junto, porque foram
 * criadas por uma regra que nao valia mais.
 *
 * NAO apaga transacao nem regra: ends_on preserva o historico e mantem a regra
 * disponivel caso o lancamento volte a acontecer.
 *
 * Roda em dry-run por padrao. Para gravar: --apply
 */

const apply = process.argv.includes('--apply')
const brl = (c: number | string) => `R$ ${(Number(c) / 100).toFixed(2)}`

async function main() {
  const res = await db.execute(sql`
    with u as (
      select rr.id, rr.label, rr.kind, rr.amount_cents, rr.starts_on,
             (select max(t.due_date) from transactions t where t.rule_id = rr.id) as ultima,
             (select count(*) from transactions t where t.rule_id = rr.id) as n_tx
      from recurrence_rules rr
      where rr.active = true and rr.ends_on is null
    )
    select *,
      (select count(*) from recurrence_occurrences o
        where o.rule_id = u.id and o.due_date > current_date
          and o.transaction_id is null and o.skipped_at is null) as occ_futuras,
      (select coalesce(sum(o.expected_cents), 0) from recurrence_occurrences o
        where o.rule_id = u.id and o.due_date > current_date
          and o.transaction_id is null and o.skipped_at is null) as occ_cents
    from u
    where ultima is null
       or ultima < (current_date - make_interval(months => ${STALE_MONTHS}))
    order by ultima nulls first, label
  `)
  const rows = ((res as any).rows ?? res) as any[]

  console.log(apply ? '=== APLICANDO ===' : '=== DRY-RUN (nada sera gravado) ===')
  console.log(`criterio: sem lancamento real ha mais de ${STALE_MONTHS} meses\n`)

  let occTotal = 0
  let centsIn = 0
  let centsOut = 0

  for (const r of rows) {
    occTotal += Number(r.occ_futuras)
    if (r.kind === 'income') centsIn += Number(r.occ_cents)
    else centsOut += Number(r.occ_cents)
    console.log(
      `${r.label} | ultima=${r.ultima ?? 'NUNCA'} | ${r.n_tx} tx | ` +
        `${r.occ_futuras} previsao(oes) futura(s) ${brl(r.occ_cents)}`,
    )
  }

  console.log(`\n--- Resumo ---`)
  console.log(`regras encerradas: ${rows.length}`)
  console.log(`previsoes futuras removidas: ${occTotal}`)
  console.log(`receita fantasma: ${brl(centsIn)}`)
  console.log(`despesa fantasma: ${brl(centsOut)}`)

  if (!apply) {
    console.log(`\nNada foi gravado. Rode com --apply para efetivar.`)
    return
  }

  for (const r of rows) {
    await db.transaction(async (tx) => {
      // Sem lancamento nenhum, a regra nunca valeu: encerra no proprio inicio.
      const end = r.ultima ?? r.starts_on
      await tx.execute(sql`update recurrence_rules set ends_on = ${end}, active = false where id = ${r.id}`)
      await tx.execute(sql`
        delete from recurrence_occurrences
        where rule_id = ${r.id} and due_date > ${end}
          and transaction_id is null and skipped_at is null
      `)
    })
  }
  console.log(`\n${rows.length} regras encerradas.`)
}

await main()
process.exit(0)
