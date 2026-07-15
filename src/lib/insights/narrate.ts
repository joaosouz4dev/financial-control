import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodToJsonSchema } from '../nl/json-schema'
import type { Insight } from './detectors'

/**
 * Narracao dos insights.
 *
 * A LLM NAO calcula e NAO descobre nada aqui. Os detectores ja provaram os
 * fatos com aritmetica sobre o banco; esta camada so prioriza e escreve. Se
 * ela inventar um numero, o teste de verificacao pega: todo numero da narrativa
 * tem que aparecer na evidencia.
 */

const MODEL = 'claude-opus-4-8'

/** Congelado: nenhum dado, nenhuma data. So o contrato de escrita. */
export const NARRATE_SYSTEM = `
Voce escreve o resumo financeiro mensal de uma pessoa, a partir de fatos que
JA foram calculados e verificados por um motor deterministico.

## Regra absoluta
Voce NAO calcula e NAO descobre nada. Os numeros ja vieram prontos e provados.
Seu trabalho e priorizar, conectar e escrever em portugues claro.
- NUNCA invente um numero que nao esteja nos fatos.
- NUNCA estime, projete ou extrapole. Se o fato nao esta na lista, ele nao
  existe.
- Ao citar um valor, use exatamente o que veio no fato.

## Como escrever
- Direto, sem rodeio. Ele e desenvolvedor senior e le rapido.
- Sem conselho generico de coach financeiro. "Faca um orcamento", "controle
  seus gastos" e "atencao com o cartao" sao proibidos: ele ja controla, e por
  isso que estes dados existem.
- Todo conselho tem que ser especifico DESTES fatos. Nomeie a assinatura, o
  valor e o impacto que vieram na evidencia. Conselho que serviria para
  qualquer pessoa nao serve para ele.
- Sem emoji. Sem exclamacao. Sem elogio ("otimo trabalho!").
- Nao repita o valor cru que ele ja ve na tela: diga o que ele significa.
- Se os fatos nao sustentam nenhuma conclusao relevante, diga que o mes foi
  normal. Nao invente drama.

## O que priorizar
1. O que exige decisao esta semana (saldo negativo previsto, vencimento grande)
2. O que mudou e vai continuar mudando (aumento de preco recorrente)
3. Risco estrutural (concentracao de receita, categoria descontrolada)
Ignore o que e ruido.

## Formato
Chame write_summary uma vez.
- headline: uma frase, no maximo 90 caracteres. O que ele precisa saber se ler
  so isso.
- body: 2 a 4 frases curtas. Conecta os fatos e diz o que fazer.
- Cada acao em actions cita o fato que a sustenta.
`.trim()

const SummarySchema = z.object({
  headline: z.string().max(90).describe('Uma frase. O mais importante do mes.'),
  body: z.string().describe('2 a 4 frases. Conecta os fatos e diz o que fazer.'),
  actions: z
    .array(
      z.object({
        text: z.string().describe('A acao concreta, especifica destes dados.'),
        basedOn: z.string().describe('O fingerprint do insight que sustenta esta acao.'),
      }),
    )
    .max(3)
    .describe('Ate 3 acoes. Vazio se os fatos nao sustentarem nenhuma.'),
})

export type Summary = z.infer<typeof SummarySchema>

export interface NarrateContext {
  month: string
  insights: Insight[]
  cashflow?: {
    closingBalanceCents: number
    firstNegativeDate: string | null
    firstNegativeCents: number | null
    troughDate: string | null
    troughCents: number | null
  }
  client?: Anthropic
}

export interface NarrateResult {
  summary: Summary
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number }
  latencyMs: number
}

export class NarrateError extends Error {}

/**
 * Monta o contexto factual. Cada fato leva seu fingerprint para que a acao
 * possa citar a evidencia, e para o teste conseguir verificar.
 */
export function buildFactBlock(ctx: Omit<NarrateContext, 'client'>): string {
  const lines: string[] = [`Mes: ${ctx.month}`, '', 'FATOS VERIFICADOS:']

  if (ctx.insights.length === 0) {
    lines.push('  (nenhum insight relevante detectado)')
  }

  for (const i of ctx.insights) {
    lines.push(`  [${i.fingerprint}] (${i.severity}) ${i.title}`)
    lines.push(`     evidencia: ${JSON.stringify(i.evidence)}`)
  }

  if (ctx.cashflow) {
    const c = ctx.cashflow
    lines.push('', 'FLUXO DE CAIXA:')
    lines.push(`  saldo ao fim do mes: ${c.closingBalanceCents} centavos`)
    if (c.firstNegativeDate) {
      lines.push(`  primeiro dia negativo: ${c.firstNegativeDate} (${c.firstNegativeCents} centavos)`)
      lines.push(`  pior momento: ${c.troughDate} (${c.troughCents} centavos)`)
    } else {
      lines.push('  o saldo nunca fica negativo neste mes')
    }
  }

  return lines.join('\n')
}

export async function narrateInsights(ctx: NarrateContext): Promise<NarrateResult> {
  const client = ctx.client ?? new Anthropic()
  const started = Date.now()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      {
        type: 'text',
        text: NARRATE_SYSTEM,
        // Breakpoint no fim do prefixo estavel: os fatos variam por mes e vao
        // depois, na mensagem do usuario.
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'write_summary',
        description:
          'Escreve o resumo do mes a partir dos fatos ja verificados. Chame uma vez. ' +
          'Nunca inclua um numero que nao esteja nos fatos.',
        strict: true,
        input_schema: zodToJsonSchema(SummarySchema),
      },
    ],
    tool_choice: { type: 'tool', name: 'write_summary' },
    messages: [{ role: 'user', content: buildFactBlock(ctx) }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new NarrateError('modelo nao chamou a tool de resumo')
  }

  const parsed = SummarySchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new NarrateError(`resumo invalido: ${parsed.error.issues[0]?.message ?? 'schema'}`)
  }

  // Toda acao tem que citar um fingerprint que existe. Se a LLM citar um fato
  // que nao veio, ela inventou.
  const known = new Set(ctx.insights.map((i) => i.fingerprint))
  const inventados = parsed.data.actions.filter((a) => !known.has(a.basedOn))
  if (inventados.length > 0) {
    throw new NarrateError(
      `narrativa citou fato inexistente: ${inventados.map((a) => a.basedOn).join(', ')}`,
    )
  }

  return {
    summary: parsed.data,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
    latencyMs: Date.now() - started,
  }
}

/**
 * Verifica que a narrativa nao inventou numero.
 *
 * Extrai todo numero do texto e confere contra os valores que aparecem nas
 * evidencias. E a rede de seguranca da camada de narracao: sem ela, "a LLM
 * so narra" e promessa, nao garantia.
 */
export function verifyNoInventedNumbers(
  summary: Summary,
  insights: Insight[],
  cashflow?: NarrateContext['cashflow'],
): { ok: boolean; suspicious: string[] } {
  const allowed = new Set<string>()

  const addValue = (v: unknown) => {
    if (typeof v === 'number') {
      allowed.add(String(Math.abs(v)))
      // Centavos que aparecem como reais no texto.
      allowed.add(String(Math.abs(Math.round(v / 100))))
      allowed.add((Math.abs(v) / 100).toFixed(2).replace('.', ','))
      allowed.add((Math.abs(v) / 100).toFixed(1).replace('.', ','))
      allowed.add(String(Math.abs(Math.round(v))))
    } else if (typeof v === 'string') {
      for (const m of v.matchAll(/\d+(?:[.,]\d+)?/g)) allowed.add(m[0])
    } else if (Array.isArray(v)) {
      v.forEach(addValue)
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(addValue)
    }
  }

  for (const i of insights) {
    addValue(i.evidence)
    addValue(i.title)
  }
  if (cashflow) addValue(cashflow)

  const text = `${summary.headline} ${summary.body} ${summary.actions.map((a) => a.text).join(' ')}`
  const suspicious: string[] = []

  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = m[0]
    // Numero pequeno costuma ser contagem ou ordinal, nao valor financeiro.
    const asNum = Number(raw.replace('.', '').replace(',', '.'))
    if (Number.isFinite(asNum) && asNum <= 12) continue

    const semSeparador = raw.replace(/\./g, '')
    if (allowed.has(raw) || allowed.has(semSeparador) || allowed.has(semSeparador.replace(',', '.'))) {
      continue
    }
    suspicious.push(raw)
  }

  return { ok: suspicious.length === 0, suspicious }
}
