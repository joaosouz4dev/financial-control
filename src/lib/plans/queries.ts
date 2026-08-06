import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  actionPlans,
  actionPlanItems,
  actionPlanCheckins,
  recurrenceRules,
  transactions,
  categories,
  contexts,
} from '@/db/schema'
import { buildPlan, type Expense, type PlanProposal } from './candidates'
import { checkinMonth, type AcceptedItem, type ActualSpend, type PlanCheckin } from './track'
import { monthRange } from '../queries'

/** As despesas ativas que alimentam o motor de propostas. */
export async function getExpensesForPlanning(contextSlug = 'pessoal'): Promise<Expense[]> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) return []

  const rows = await db
    .select({
      ruleId: recurrenceRules.id,
      label: recurrenceRules.label,
      amountCents: recurrenceRules.amountCents,
      categorySlug: categories.slug,
      installmentTotal: recurrenceRules.installmentTotal,
    })
    .from(recurrenceRules)
    .leftJoin(categories, eq(categories.id, recurrenceRules.categoryId))
    .where(
      and(
        eq(recurrenceRules.contextId, ctx.id),
        eq(recurrenceRules.active, true),
        eq(recurrenceRules.kind, 'expense'),
      ),
    )

  return rows.map((r) => ({
    ruleId: r.ruleId,
    label: r.label,
    amountCents: r.amountCents,
    categorySlug: r.categorySlug ?? null,
    // Sem telemetria de uso ainda: o detector de orfa depende disto e por ora
    // fica null, o que significa "nao sei", nao "nao usa".
    monthsSinceSignal: null,
    isInstallment: r.installmentTotal !== null,
  }))
}

export async function proposePlan(targetCents: number, contextSlug = 'pessoal'): Promise<PlanProposal> {
  return buildPlan(await getExpensesForPlanning(contextSlug), targetCents)
}

export interface SavedPlan {
  id: string
  title: string
  targetCents: number | null
  status: 'draft' | 'active' | 'done' | 'abandoned'
  startsOn: string | null
  createdAt: Date
  items: Array<{
    id: string
    ruleId: string | null
    title: string
    savingCents: number
    pain: number
    accepted: boolean | null
  }>
}

export async function createPlan(
  title: string,
  targetCents: number,
  proposal: PlanProposal,
  contextSlug = 'pessoal',
): Promise<string> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) throw new Error('Contexto não encontrado')

  const [plan] = await db
    .insert(actionPlans)
    .values({
      contextId: ctx.id,
      title,
      targetCents,
      status: 'draft',
      startsOn: new Date().toISOString().slice(0, 10),
    })
    .returning()

  if (proposal.items.length > 0) {
    await db.insert(actionPlanItems).values(
      proposal.items.map((i) => ({
        planId: plan!.id,
        ruleId: i.ruleId,
        title: `${i.kind === 'reduce' ? 'Reduzir' : 'Cancelar'} ${i.label}`,
        savingCents: i.savingCents,
        pain: i.pain,
        // accepted null = ainda nao decidiu.
        accepted: null,
      })),
    )
  }

  return plan!.id
}

export async function getPlan(planId: string): Promise<SavedPlan | null> {
  const [plan] = await db.select().from(actionPlans).where(eq(actionPlans.id, planId)).limit(1)
  if (!plan) return null

  const items = await db
    .select()
    .from(actionPlanItems)
    .where(eq(actionPlanItems.planId, planId))
    .orderBy(desc(actionPlanItems.savingCents))

  return {
    id: plan.id,
    title: plan.title,
    targetCents: plan.targetCents,
    status: plan.status,
    startsOn: plan.startsOn,
    createdAt: plan.createdAt,
    items: items.map((i) => ({
      id: i.id,
      ruleId: i.ruleId,
      title: i.title,
      savingCents: i.savingCents,
      pain: i.pain,
      accepted: i.accepted,
    })),
  }
}

export async function listPlans(contextSlug = 'pessoal'): Promise<SavedPlan[]> {
  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) return []

  const plans = await db
    .select()
    .from(actionPlans)
    .where(eq(actionPlans.contextId, ctx.id))
    .orderBy(desc(actionPlans.createdAt))

  const out: SavedPlan[] = []
  for (const p of plans) {
    const full = await getPlan(p.id)
    if (full) out.push(full)
  }
  return out
}

/** Aceita ou rejeita um item. O plano vira ativo no primeiro aceite. */
export async function decideItem(itemId: string, accepted: boolean): Promise<void> {
  const [item] = await db
    .update(actionPlanItems)
    .set({ accepted, decidedAt: new Date() })
    .where(eq(actionPlanItems.id, itemId))
    .returning()

  if (item && accepted) {
    await db
      .update(actionPlans)
      .set({ status: 'active' })
      .where(and(eq(actionPlans.id, item.planId), eq(actionPlans.status, 'draft')))
  }
}

/**
 * Confere o mes contra o plano. E aqui que o sistema cobra.
 */
export async function checkinPlan(
  planId: string,
  month: string,
  contextSlug = 'pessoal',
): Promise<PlanCheckin | null> {
  const plan = await getPlan(planId)
  if (!plan) return null

  const accepted = plan.items.filter((i) => i.accepted === true)
  if (accepted.length === 0) return null

  const [ctx] = await db.select().from(contexts).where(eq(contexts.slug, contextSlug)).limit(1)
  if (!ctx) return null

  // Baseline: o que a regra valia quando o plano foi criado.
  const ruleIds = accepted.map((i) => i.ruleId).filter((r): r is string => r !== null)
  const rules =
    ruleIds.length > 0
      ? await db
          .select()
          .from(recurrenceRules)
          .where(sql`${recurrenceRules.id} in ${ruleIds}`)
      : []
  const baselineByRule = new Map(rules.map((r) => [r.id, r.amountCents]))

  const acceptedItems: AcceptedItem[] = accepted.map((i) => {
    const baseline = i.ruleId ? (baselineByRule.get(i.ruleId) ?? i.savingCents) : i.savingCents
    return {
      itemId: i.id,
      ruleId: i.ruleId,
      label: i.title.replace(/^(Cancelar|Reduzir)\s+/, ''),
      savingCents: i.savingCents,
      baselineCents: baseline,
      kind: i.title.startsWith('Reduzir') ? 'reduce' : 'cancel',
    }
  })

  const { from, to } = monthRange(month)
  const spend = await db
    .select({
      ruleId: transactions.ruleId,
      label: transactions.description,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.contextId, ctx.id),
        eq(transactions.kind, 'expense'),
        gte(transactions.dueDate, from),
        lte(transactions.dueDate, to),
      ),
    )

  const actual: ActualSpend[] = spend.map((s) => ({
    ruleId: s.ruleId,
    label: s.label,
    amountCents: s.amountCents,
  }))

  const result = checkinMonth(month, acceptedItems, actual)

  // Persiste o veredito para o historico do plano.
  await db
    .insert(actionPlanCheckins)
    .values({
      planId,
      month: from,
      expectedCents: result.promisedCents,
      actualCents: result.savedCents,
      note: result.onTrack ? 'no trilho' : `${result.brokenCount} item(ns) fora do combinado`,
    })
    .onConflictDoNothing()

  return result
}
