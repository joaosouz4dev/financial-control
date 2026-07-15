import {
  pgTable,
  pgEnum,
  uuid,
  text,
  date,
  timestamp,
  smallint,
  integer,
  boolean,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { cents } from './types/cents'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * transfer existe para resolver a dupla contagem do cartao: a compra e a
 * despesa (bate na categoria), pagar a fatura e transferencia entre contas.
 * Todo agregado por categoria filtra kind <> 'transfer'.
 */
export const txKind = pgEnum('tx_kind', ['expense', 'income', 'transfer'])
export const accountKind = pgEnum('account_kind', ['checking', 'credit_card', 'cash', 'investment'])
export const entrySource = pgEnum('entry_source', ['nl', 'manual', 'import', 'recurrence'])
export const cadence = pgEnum('cadence', ['monthly', 'weekly', 'biweekly', 'yearly', 'one_off'])
export const insightStatus = pgEnum('insight_status', ['pending', 'accepted', 'rejected', 'expired'])
export const planStatus = pgEnum('plan_status', ['draft', 'active', 'done', 'abandoned'])

// ---------------------------------------------------------------------------
// Usuarios e contextos (Auth.js + PF/PJ)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid().defaultRandom().primaryKey(),
  name: text(),
  email: text().notNull().unique(),
  emailVerified: timestamp({ withTimezone: true }),
  image: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const accountsAuth = pgTable(
  'accounts_auth',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp({ withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

/**
 * PF / PJ. Nao e uma tag: metas e relatorios sao independentes por contexto,
 * e o rollup consolidado e apenas omitir o predicado de context_id.
 */
export const contexts = pgTable('contexts', {
  id: uuid().defaultRandom().primaryKey(),
  slug: text().notNull().unique(), // 'pessoal' | 'empresa'
  name: text().notNull(),
  color: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const userContexts = pgTable(
  'user_contexts',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contextId: uuid()
      .notNull()
      .references(() => contexts.id, { onDelete: 'cascade' }),
    role: text().notNull().default('owner'), // owner | member | viewer
  },
  (t) => [primaryKey({ columns: [t.userId, t.contextId] })],
)

// ---------------------------------------------------------------------------
// Contas e categorias
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().defaultRandom().primaryKey(),
    contextId: uuid()
      .notNull()
      .references(() => contexts.id),
    name: text().notNull(), // 'Cartao Joao Sicredi', 'Conta Caixa'
    kind: accountKind().notNull(),
    /** Cartao: dia de fechamento e vencimento da fatura. */
    statementCloseDay: smallint(),
    statementDueDay: smallint(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_context_idx').on(t.contextId)],
)

export const categories = pgTable(
  'categories',
  {
    id: uuid().defaultRandom().primaryKey(),
    slug: text().notNull(), // 'casa', 'alimentacao', ...
    name: text().notNull(),
    parentId: uuid().references((): any => categories.id),
    color: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('categories_slug_key').on(t.slug)],
)

// ---------------------------------------------------------------------------
// Faturas de cartao
// ---------------------------------------------------------------------------

export const cardStatements = pgTable(
  'card_statements',
  {
    id: uuid().defaultRandom().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
    dueDate: date().notNull(),
    closedAt: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex('card_statements_account_period_key').on(t.accountId, t.periodEnd)],
)

// ---------------------------------------------------------------------------
// Recorrencia: regra (intencao) + ocorrencias (estado)
// ---------------------------------------------------------------------------

/**
 * A regra guarda a intencao: "Marmore, parcela 5 de 6, dia 2, R$ 369".
 * Ela sabe quando morre, entao a geracao para sozinha. E isto que substitui
 * o copy-paste mensal da planilha.
 */
export const recurrenceRules = pgTable(
  'recurrence_rules',
  {
    id: uuid().defaultRandom().primaryKey(),
    contextId: uuid()
      .notNull()
      .references(() => contexts.id),
    kind: txKind().notNull(),
    label: text().notNull(), // 'Netflix', 'Financiamento Casa'
    categoryId: uuid().references(() => categories.id),
    accountId: uuid().references(() => accounts.id),

    /** Valor esperado + a intencao por tras dele. */
    amountCents: cents().notNull(),
    amountExpression: text(), // '=4*550'
    amountInputs: jsonb().$type<Record<string, number | string>>(), // {semanas:4, unitario_cents:55000}

    cadence: cadence().notNull().default('monthly'),
    dayOfMonth: smallint(), // 30 = ultimo dia do mes (ver generate.ts)

    /** Parcelamento: 'Parcela Carro 06/25' -> current=6, total=25. */
    installmentCurrent: smallint(),
    installmentTotal: smallint(),
    /** Ancora: a data da parcela installmentCurrent. Base da contagem. */
    installmentAnchor: date(),

    /** Assinatura em moeda estrangeira: '=2.86*6.5' e USD * cambio. */
    fxCurrency: text(),
    fxAmount: numeric({ precision: 12, scale: 4 }),

    startsOn: date().notNull(),
    endsOn: date(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recurrence_rules_context_idx').on(t.contextId),
    index('recurrence_rules_active_idx').on(t.active),
  ],
)

/**
 * Ocorrencia = uma instancia prevista da regra num mes. Carrega o estado
 * (pago? quanto de fato?). Gerada num horizonte rolante de ~13 meses.
 * O unique (rule, dueDate) e o que torna o gerador idempotente.
 */
export const recurrenceOccurrences = pgTable(
  'recurrence_occurrences',
  {
    id: uuid().defaultRandom().primaryKey(),
    ruleId: uuid()
      .notNull()
      .references(() => recurrenceRules.id, { onDelete: 'cascade' }),
    dueDate: date().notNull(),
    expectedCents: cents().notNull(),
    /** Cambio usado nesta ocorrencia: separa "subiu o preco" de "subiu o dolar". */
    fxRate: numeric({ precision: 12, scale: 6 }),
    installmentNo: smallint(),
    transactionId: uuid(), // FK adicionada via SQL (circular com transactions)
    skippedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('recurrence_occurrences_rule_due_key').on(t.ruleId, t.dueDate),
    // Parcial: "o que ainda esta aberto" so toca linhas nao realizadas.
    index('recurrence_occurrences_open_idx')
      .on(t.dueDate)
      .where(sql`${t.transactionId} is null and ${t.skippedAt} is null`),
  ],
)

// ---------------------------------------------------------------------------
// Transacoes
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  'transactions',
  {
    id: uuid().defaultRandom().primaryKey(),
    contextId: uuid()
      .notNull()
      .references(() => contexts.id),
    kind: txKind().notNull(),

    amountCents: cents().notNull(),
    amountExpression: text(),
    amountInputs: jsonb().$type<Record<string, number | string>>(),

    description: text().notNull(),
    categoryId: uuid().references(() => categories.id),
    accountId: uuid().references(() => accounts.id),
    /** Transferencia: conta destino. Single-row, nao duas linhas espelhadas. */
    counterpartyAccountId: uuid().references((): any => accounts.id),

    /** Coluna D da planilha. */
    dueDate: date().notNull(),
    /** Coluna C da planilha: null = nao pago. Sem boolean derivavel. */
    paidAt: timestamp({ withTimezone: true }),

    statementId: uuid().references(() => cardStatements.id),
    ruleId: uuid().references(() => recurrenceRules.id),
    occurrenceId: uuid().references(() => recurrenceOccurrences.id),

    source: entrySource().notNull().default('manual'),
    rawText: text(), // o que ele digitou, quando veio de linguagem natural
    extractionId: uuid(),
    notes: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transactions_context_due_idx').on(t.contextId, t.dueDate.desc()),
    index('transactions_category_due_idx').on(t.categoryId, t.dueDate),
    index('transactions_account_due_idx').on(t.accountId, t.dueDate.desc()),
    index('transactions_statement_idx').on(t.statementId),
    // Powers o lag() que detecta variacao de preco (Netflix 44,90 -> 59,90).
    index('transactions_rule_due_idx').on(t.ruleId, t.dueDate),
  ],
)

/** Rateio: um monitor 50% PJ / 50% PF, sem fracionar o contexto da transacao. */
export const transactionSplits = pgTable(
  'transaction_splits',
  {
    id: uuid().defaultRandom().primaryKey(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    contextId: uuid().references(() => contexts.id),
    categoryId: uuid().references(() => categories.id),
    amountCents: cents().notNull(),
    note: text(),
  },
  (t) => [index('transaction_splits_tx_idx').on(t.transactionId)],
)

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------

/**
 * Versionadas por effectiveFrom: um mes historico e avaliado contra a meta
 * que estava em vigor naquele mes, nao contra a meta de hoje.
 */
export const goals = pgTable(
  'goals',
  {
    id: uuid().defaultRandom().primaryKey(),
    contextId: uuid()
      .notNull()
      .references(() => contexts.id),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id),
    pctOfIncome: numeric({ precision: 5, scale: 2 }).notNull(), // 20.00
    effectiveFrom: date().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('goals_ctx_cat_from_key').on(t.contextId, t.categoryId, t.effectiveFrom)],
)

// ---------------------------------------------------------------------------
// Vocabulario (substitui fine-tuning)
// ---------------------------------------------------------------------------

export const aliases = pgTable(
  'aliases',
  {
    id: uuid().defaultRandom().primaryKey(),
    surface: text().notNull(), // 'marmore', 'socios yt prime', 'zaya escola'
    targetType: text().notNull(), // 'recurrence_rule' | 'category' | 'account'
    targetId: uuid().notNull(),
    hits: integer().notNull().default(1),
    lastUsedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex('aliases_surface_target_key').on(t.surface, t.targetType)],
)

// ---------------------------------------------------------------------------
// Cambio
// ---------------------------------------------------------------------------

export const fxRates = pgTable(
  'fx_rates',
  {
    currency: text().notNull(),
    day: date().notNull(),
    rate: numeric({ precision: 12, scale: 6 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.day] })],
)

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const imports = pgTable('imports', {
  id: uuid().defaultRandom().primaryKey(),
  filename: text().notNull(),
  kind: text().notNull(), // 'xlsx' | 'ofx' | 'csv'
  periodLabel: text(), // '07/2026'
  stats: jsonb().$type<Record<string, unknown>>(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const importedTransactions = pgTable(
  'imported_transactions',
  {
    id: uuid().defaultRandom().primaryKey(),
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    /** Dedup deterministico: fitid do OFX, ou hash(conta,data,valor,memo). */
    dedupHash: text().notNull(),
    rawPayload: jsonb().notNull(),
    matchedTransactionId: uuid().references(() => transactions.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Unique e restricao de corretude aqui, nao dica de performance.
  (t) => [uniqueIndex('imported_transactions_dedup_key').on(t.dedupHash)],
)

// ---------------------------------------------------------------------------
// Inteligencia
// ---------------------------------------------------------------------------

/** Rastro da LLM: o que ela viu, o que disse, o que ele corrigiu. */
export const extractions = pgTable('extractions', {
  id: uuid().defaultRandom().primaryKey(),
  rawText: text().notNull(),
  model: text().notNull(),
  toolInput: jsonb().notNull(),
  candidates: jsonb(),
  resolvedTransactionId: uuid().references(() => transactions.id),
  userAction: text(), // accepted | edited | rejected
  userDiff: jsonb(),
  latencyMs: integer(),
  usage: jsonb(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

/**
 * Gerado pelo motor deterministico. A LLM narra isto, nunca o inventa.
 * evidence guarda os dados reais que provaram o insight.
 */
export const insights = pgTable(
  'insights',
  {
    id: uuid().defaultRandom().primaryKey(),
    contextId: uuid().references(() => contexts.id),
    type: text().notNull(), // 'price_change' | 'goal_exceeded' | 'orphan_subscription' | ...
    severity: text().notNull().default('info'), // info | warn | critical
    /** Dedup: mesmo insight nao reaparece todo dia. */
    fingerprint: text().notNull(),
    title: text().notNull(),
    evidence: jsonb().notNull(),
    narrative: text(), // preenchido pela LLM
    status: insightStatus().notNull().default('pending'),
    detectedFor: date().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('insights_fingerprint_key').on(t.fingerprint),
    index('insights_status_idx').on(t.status, t.detectedFor.desc()),
  ],
)

export const actionPlans = pgTable('action_plans', {
  id: uuid().defaultRandom().primaryKey(),
  contextId: uuid().references(() => contexts.id),
  title: text().notNull(),
  targetCents: cents(), // 'quero economizar 2k/mes'
  status: planStatus().notNull().default('draft'),
  startsOn: date(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const actionPlanItems = pgTable('action_plan_items', {
  id: uuid().defaultRandom().primaryKey(),
  planId: uuid()
    .notNull()
    .references(() => actionPlans.id, { onDelete: 'cascade' }),
  ruleId: uuid().references(() => recurrenceRules.id),
  title: text().notNull(),
  savingCents: cents().notNull(),
  /** 1 = indolor (assinatura nao usada), 5 = doi (cortar escola). */
  pain: smallint().notNull().default(3),
  accepted: boolean(),
  decidedAt: timestamp({ withTimezone: true }),
})

export const actionPlanCheckins = pgTable('action_plan_checkins', {
  id: uuid().defaultRandom().primaryKey(),
  planId: uuid()
    .notNull()
    .references(() => actionPlans.id, { onDelete: 'cascade' }),
  month: date().notNull(),
  expectedCents: cents().notNull(),
  actualCents: cents().notNull(),
  note: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const contextsRelations = relations(contexts, ({ many }) => ({
  transactions: many(transactions),
  accounts: many(accounts),
  rules: many(recurrenceRules),
  goals: many(goals),
}))

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  context: one(contexts, { fields: [transactions.contextId], references: [contexts.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  statement: one(cardStatements, { fields: [transactions.statementId], references: [cardStatements.id] }),
  rule: one(recurrenceRules, { fields: [transactions.ruleId], references: [recurrenceRules.id] }),
  splits: many(transactionSplits),
}))

export const recurrenceRulesRelations = relations(recurrenceRules, ({ one, many }) => ({
  context: one(contexts, { fields: [recurrenceRules.contextId], references: [contexts.id] }),
  category: one(categories, { fields: [recurrenceRules.categoryId], references: [categories.id] }),
  occurrences: many(recurrenceOccurrences),
}))

export const recurrenceOccurrencesRelations = relations(recurrenceOccurrences, ({ one }) => ({
  rule: one(recurrenceRules, { fields: [recurrenceOccurrences.ruleId], references: [recurrenceRules.id] }),
}))
