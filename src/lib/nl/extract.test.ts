import { describe, it, expect, vi } from 'vitest'
import { extractTransactions, ExtractionError } from './extract'
import { zodToJsonSchema } from './json-schema'
import { ExtractionSchema } from './schema'
import { SYSTEM_STATIC } from './prompt'

/**
 * Testa tudo menos a rede: o schema enviado, o prompt caching, a validacao da
 * saida, e o que acontece quando o modelo devolve lixo.
 */

function fakeClient(toolInput: unknown, usage: Partial<Record<string, number>> = {}) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'extract_transactions', input: toolInput }],
    model: 'claude-opus-4-8',
    usage: {
      input_tokens: 50,
      output_tokens: 120,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 800,
      ...usage,
    },
  })
  return { client: { messages: { create } } as never, create }
}

const VALID = {
  transactions: [
    {
      kind: 'expense',
      amount: { asWritten: '90', impliesMath: false, mathNote: null },
      labelHint: 'agua',
      dateRef: { type: 'today' },
      recurrence: 'monthly',
      intent: 'record',
      installment: null,
      confidence: 0.95,
      ambiguity: null,
    },
  ],
}

describe('zodToJsonSchema', () => {
  const schema = zodToJsonSchema(ExtractionSchema)

  it('gera schema sem $ref (o modelo lê melhor inline)', () => {
    expect(JSON.stringify(schema)).not.toContain('$ref')
  })

  /**
   * strict:true exige additionalProperties:false E required completo em todo
   * objeto. Sem isso a API rejeita a tool, e sem strict o modelo pode inventar
   * um campo que so pegariamos na validacao, depois de gastar os tokens.
   */
  it('é compatível com strict: todo objeto fechado e com required completo', () => {
    const problemas: string[] = []

    const walk = (n: unknown, path = '$'): void => {
      if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}[${i}]`))
      if (!n || typeof n !== 'object') return
      const o = n as Record<string, any>
      if (o.type === 'object' && o.properties) {
        if (o.additionalProperties !== false) problemas.push(`${path}: aberto`)
        const faltando = Object.keys(o.properties).filter((p) => !(o.required ?? []).includes(p))
        if (faltando.length) problemas.push(`${path}: sem required ${faltando.join(',')}`)
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
    }

    walk(schema)
    expect(problemas).toEqual([])
  })

  it('descreve a regra de copiar o valor literalmente', () => {
    const s = JSON.stringify(schema)
    expect(s).toContain('literalmente')
    expect(s).toContain('NAO calcule')
  })

  it('expõe as quatro intenções', () => {
    const s = JSON.stringify(schema)
    for (const intent of ['record', 'price_change', 'new_recurring', 'cancel']) {
      expect(s).toContain(intent)
    }
  })

  it('dateRef é união de referências, não string de data', () => {
    const s = JSON.stringify(schema)
    expect(s).toContain('today')
    expect(s).toContain('last_week')
    expect(s).toContain('unspecified')
  })
})

describe('system prompt: precisa ficar cacheável', () => {
  it('não contém data nem ano (invalidaria o cache todo request)', () => {
    expect(SYSTEM_STATIC).not.toMatch(/\b20\d\d\b/)
    expect(SYSTEM_STATIC).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('carrega o vocabulário dele', () => {
    for (const termo of ['Marmore', 'Zaya', 'Tauana', 'Vansa', 'Sendeasy']) {
      expect(SYSTEM_STATIC).toContain(termo)
    }
  })

  it('afirma a regra central', () => {
    expect(SYSTEM_STATIC).toContain('Voce NAO calcula')
  })
})

describe('extractTransactions', () => {
  it('envia o system com cache_control no fim do prefixo estável', async () => {
    const { client, create } = fakeClient(VALID)
    await extractTransactions('paguei 90 de agua hoje', { client })

    const args = create.mock.calls[0]![0]
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(args.system[0].text).toBe(SYSTEM_STATIC)
  })

  /**
   * A data no system prompt quebraria o cache em todo request. Ela tem que ir
   * na mensagem do usuario, depois do breakpoint.
   */
  it('mantém a data fora do system e dentro da mensagem do usuário', async () => {
    const { client, create } = fakeClient(VALID)
    await extractTransactions('paguei 90 de agua hoje', { client, today: '2026-07-15' })

    const args = create.mock.calls[0]![0]
    expect(args.system[0].text).not.toContain('2026-07-15')
    expect(args.messages[0].content).toContain('2026-07-15')
  })

  it('passa o vocabulário depois do breakpoint, não no system', async () => {
    const { client, create } = fakeClient(VALID)
    await extractTransactions('paguei a agua', {
      client,
      knownLabels: ['Conta de Agua', 'Netflix'],
    })

    const args = create.mock.calls[0]![0]
    expect(args.system[0].text).not.toContain('Conta de Agua')
    expect(args.messages[0].content).toContain('Conta de Agua')
  })

  it('força a tool e usa Opus 4.8', async () => {
    const { client, create } = fakeClient(VALID)
    await extractTransactions('x', { client })

    const args = create.mock.calls[0]![0]
    expect(args.model).toBe('claude-opus-4-8')
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'extract_transactions' })
    expect(args.tools[0].name).toBe('extract_transactions')
  })

  it('reporta o uso de cache', async () => {
    const { client } = fakeClient(VALID)
    const r = await extractTransactions('x', { client })
    expect(r.usage.cacheReadInputTokens).toBe(800)
    expect(r.model).toBe('claude-opus-4-8')
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('devolve a extração validada', async () => {
    const { client } = fakeClient(VALID)
    const r = await extractTransactions('paguei 90 de agua hoje', { client })
    expect(r.extraction.transactions[0]).toMatchObject({
      kind: 'expense',
      labelHint: 'agua',
      intent: 'record',
    })
  })

  /**
   * A barreira: saida fora do schema estoura ANTES de qualquer coisa chegar
   * perto do banco.
   */
  it('rejeita saída que não bate com o schema', async () => {
    const { client } = fakeClient({ transactions: [{ kind: 'expense' }] })
    await expect(extractTransactions('x', { client })).rejects.toThrow(ExtractionError)
  })

  it('rejeita valor numérico onde o schema pede string', async () => {
    const { client } = fakeClient({
      transactions: [{ ...VALID.transactions[0], amount: { asWritten: 90, impliesMath: false, mathNote: null } }],
    })
    await expect(extractTransactions('x', { client })).rejects.toThrow(ExtractionError)
  })

  it('rejeita array vazio (o schema exige ao menos uma)', async () => {
    const { client } = fakeClient({ transactions: [] })
    await expect(extractTransactions('x', { client })).rejects.toThrow(ExtractionError)
  })

  it('estoura quando o modelo não chama a tool', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'não entendi' }],
      model: 'claude-opus-4-8',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const client = { messages: { create } } as never
    await expect(extractTransactions('x', { client })).rejects.toThrow(/nao chamou a tool/)
  })
})
