import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from './json-schema'
import { ExtractionSchema, type Extraction } from './schema'
import { SYSTEM_STATIC } from './prompt'

/**
 * Chamada de extracao.
 *
 * Prompt caching: o system prompt e congelado e recebe o breakpoint. O
 * contexto volatil (data de hoje, vocabulario) vai na mensagem do usuario,
 * DEPOIS do breakpoint. Assim o prefixo nao muda entre requests e o cache e
 * lido em vez de reescrito.
 *
 * Modelo: Opus 4.8. Sao ~43 lancamentos por mes, entao o custo e irrelevante
 * (fracao de centavo por extracao) e errar a intencao e caro.
 */

const MODEL = 'claude-opus-4-8'

export interface ExtractOptions {
  /** Vocabulario dele: labels das regras ativas. Vai depois do cache. */
  knownLabels?: string[]
  /** Data de hoje no fuso dele, YYYY-MM-DD. Nunca vai no system prompt. */
  today?: string
  client?: Anthropic
}

export interface ExtractResult {
  extraction: Extraction
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
  }
  model: string
  latencyMs: number
  rawToolInput: unknown
}

export class ExtractionError extends Error {}

export async function extractTransactions(
  text: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const client = opts.client ?? new Anthropic()
  const started = Date.now()

  // Contexto volatil: depois do breakpoint de cache, na mensagem do usuario.
  const context: string[] = []
  if (opts.today) context.push(`Hoje e ${opts.today}.`)
  if (opts.knownLabels?.length) {
    context.push(`Lancamentos que ele ja tem cadastrados: ${opts.knownLabels.join(', ')}.`)
  }

  const userContent = context.length ? `${context.join('\n')}\n\n---\n\n${text}` : text

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      {
        type: 'text',
        text: SYSTEM_STATIC,
        // O breakpoint fica no fim do prefixo estavel. Tudo depois disto varia
        // por request e nao deve ser cacheado.
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'extract_transactions',
        description:
          'Extrai as transacoes financeiras da mensagem. Chame exatamente uma vez, com um ' +
          'elemento por transacao mencionada. Chame mesmo quando a mensagem for ambigua: ' +
          'use confidence baixa e preencha ambiguity, em vez de chutar ou pular.',
        // strict garante que o input valida exatamente contra o schema: sem
        // isso, o modelo pode devolver um campo a mais e so descobririamos na
        // validacao, depois de gastar os tokens.
        strict: true,
        input_schema: zodToJsonSchema(ExtractionSchema),
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_transactions' },
    messages: [{ role: 'user', content: userContent }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new ExtractionError('modelo nao chamou a tool de extracao')
  }

  // A validacao acontece aqui: se a LLM devolveu algo fora do schema, isso
  // estoura antes de qualquer coisa chegar perto do banco.
  const parsed = ExtractionSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new ExtractionError(`saida invalida: ${parsed.error.issues[0]?.message ?? 'schema'}`)
  }

  return {
    extraction: parsed.data,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
    model: response.model,
    latencyMs: Date.now() - started,
    rawToolInput: toolUse.input,
  }
}
