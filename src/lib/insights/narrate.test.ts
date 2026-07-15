import { describe, it, expect, vi } from 'vitest'
import {
  buildFactBlock,
  narrateInsights,
  verifyNoInventedNumbers,
  NarrateError,
  NARRATE_SYSTEM,
  type Summary,
} from './narrate'
import type { Insight } from './detectors'

// Os insights reais dele, julho/2026.
const INSIGHTS: Insight[] = [
  {
    type: 'price_change',
    severity: 'warn',
    fingerprint: 'price_change:netflix:2026-07',
    title: 'Netflix passou de R$ 44,90 para R$ 59,90 (+33,4%)',
    evidence: {
      label: 'Netflix',
      fromCents: 4490,
      toCents: 5990,
      deltaCents: 1500,
      deltaPct: 33.41,
      annualImpactCents: 18000,
      fromMonth: '2026-06',
      toMonth: '2026-07',
    },
  },
  {
    type: 'income_concentration',
    severity: 'warn',
    fingerprint: 'income_concentration:2026-07',
    title: 'Sendeasy e Vansa são 60% da sua receita',
    evidence: {
      month: '2026-07',
      totalCents: 1829860,
      top2Pct: 60.11,
      topSources: [
        { label: 'Sendeasy', amountCents: 600000, sharePct: 32.79 },
        { label: 'Vansa', amountCents: 500000, sharePct: 27.32 },
      ],
    },
  },
]

const SUMMARY: Summary = {
  headline: 'Netflix subiu 33% e Outros está 5x acima da meta',
  body: 'A Netflix passou de R$ 44,90 para R$ 59,90, R$ 180,00 a mais por ano.',
  actions: [{ text: 'Revisar o plano da Netflix', basedOn: 'price_change:netflix:2026-07' }],
}

function fakeClient(toolInput: unknown) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', id: 't1', name: 'write_summary', input: toolInput }],
    model: 'claude-opus-4-8',
    usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 700 },
  })
  return { client: { messages: { create } } as never, create }
}

describe('NARRATE_SYSTEM: precisa ficar cacheável e proibir conselho genérico', () => {
  it('não contém data nem valor (invalidaria o cache)', () => {
    expect(NARRATE_SYSTEM).not.toMatch(/\d{4}-\d{2}/)
    expect(NARRATE_SYSTEM).not.toMatch(/R\$\s*\d/)
  })

  it('proíbe explicitamente o conselho de coach', () => {
    expect(NARRATE_SYSTEM).toContain('coach')
    expect(NARRATE_SYSTEM).toContain('Faca um orcamento')
  })

  it('afirma que a LLM não calcula', () => {
    expect(NARRATE_SYSTEM).toContain('Voce NAO calcula')
  })
})

describe('buildFactBlock', () => {
  it('leva o fingerprint junto de cada fato, para a ação poder citar', () => {
    const b = buildFactBlock({ month: '2026-07', insights: INSIGHTS })
    expect(b).toContain('[price_change:netflix:2026-07]')
    expect(b).toContain('[income_concentration:2026-07]')
  })

  it('inclui a evidência crua, não só o título', () => {
    const b = buildFactBlock({ month: '2026-07', insights: INSIGHTS })
    expect(b).toContain('annualImpactCents')
    expect(b).toContain('18000')
  })

  it('diz explicitamente quando o saldo nunca fica negativo', () => {
    const b = buildFactBlock({
      month: '2026-07',
      insights: [],
      cashflow: {
        closingBalanceCents: 511262,
        firstNegativeDate: null,
        firstNegativeCents: null,
        troughDate: null,
        troughCents: null,
      },
    })
    expect(b).toContain('nunca fica negativo')
  })

  it('não inventa drama quando não há insight', () => {
    const b = buildFactBlock({ month: '2026-07', insights: [] })
    expect(b).toContain('nenhum insight relevante')
  })
})

describe('narrateInsights', () => {
  it('usa cache_control no fim do prefixo estável', async () => {
    const { client, create } = fakeClient(SUMMARY)
    await narrateInsights({ month: '2026-07', insights: INSIGHTS, client })

    const args = create.mock.calls[0]![0]
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(args.system[0].text).toBe(NARRATE_SYSTEM)
  })

  it('manda os fatos depois do breakpoint, na mensagem', async () => {
    const { client, create } = fakeClient(SUMMARY)
    await narrateInsights({ month: '2026-07', insights: INSIGHTS, client })

    const args = create.mock.calls[0]![0]
    expect(args.system[0].text).not.toContain('Netflix')
    expect(args.messages[0].content).toContain('Netflix')
  })

  /**
   * A rede de seguranca: se a LLM citar um fato que nao existe, ela inventou,
   * e isso estoura antes de chegar na tela.
   */
  it('rejeita ação que cita fato inexistente', async () => {
    const { client } = fakeClient({
      ...SUMMARY,
      actions: [{ text: 'Cortar a Disney+', basedOn: 'price_change:disney:2026-07' }],
    })
    await expect(narrateInsights({ month: '2026-07', insights: INSIGHTS, client })).rejects.toThrow(
      /fato inexistente/,
    )
  })

  it('aceita ação que cita fato real', async () => {
    const { client } = fakeClient(SUMMARY)
    const r = await narrateInsights({ month: '2026-07', insights: INSIGHTS, client })
    expect(r.summary.actions[0]!.basedOn).toBe('price_change:netflix:2026-07')
  })

  it('rejeita saída fora do schema', async () => {
    const { client } = fakeClient({ headline: 'x' })
    await expect(narrateInsights({ month: '2026-07', insights: INSIGHTS, client })).rejects.toThrow(
      NarrateError,
    )
  })

  it('rejeita headline longa demais', async () => {
    const { client } = fakeClient({ ...SUMMARY, headline: 'x'.repeat(200) })
    await expect(narrateInsights({ month: '2026-07', insights: INSIGHTS, client })).rejects.toThrow(
      NarrateError,
    )
  })
})

describe('verifyNoInventedNumbers: a garantia de que a LLM não mente', () => {
  it('aceita narrativa que só usa números dos fatos', () => {
    const v = verifyNoInventedNumbers(SUMMARY, INSIGHTS)
    expect(v.ok).toBe(true)
    expect(v.suspicious).toEqual([])
  })

  it('pega número inventado', () => {
    const mentiroso: Summary = {
      ...SUMMARY,
      body: 'A Netflix passou de R$ 44,90 para R$ 59,90, e você gastou R$ 7.432,15 em lazer.',
    }
    const v = verifyNoInventedNumbers(mentiroso, INSIGHTS)
    expect(v.ok).toBe(false)
    expect(v.suspicious.some((s) => s.includes('432'))).toBe(true)
  })

  it('pega projeção inventada', () => {
    const extrapolador: Summary = {
      ...SUMMARY,
      body: 'No ritmo atual você vai gastar R$ 158.231,00 até dezembro.',
    }
    expect(verifyNoInventedNumbers(extrapolador, INSIGHTS).ok).toBe(false)
  })

  it('ignora número pequeno (contagem, ordinal)', () => {
    const s: Summary = { ...SUMMARY, body: 'Há 3 assinaturas e 2 cartões.' }
    expect(verifyNoInventedNumbers(s, INSIGHTS).ok).toBe(true)
  })

  it('aceita valores do fluxo de caixa quando fornecidos', () => {
    const s: Summary = {
      ...SUMMARY,
      body: 'O saldo fica negativo em 2026-07-12, chegando a -R$ 673,00.',
    }
    const v = verifyNoInventedNumbers(s, INSIGHTS, {
      closingBalanceCents: 511262,
      firstNegativeDate: '2026-07-12',
      firstNegativeCents: -67300,
      troughDate: '2026-07-12',
      troughCents: -67300,
    })
    expect(v.ok).toBe(true)
  })

  it('aceita o percentual que veio na evidência', () => {
    const s: Summary = { ...SUMMARY, headline: 'Netflix +33,41% e concentração de 60,11%' }
    expect(verifyNoInventedNumbers(s, INSIGHTS).ok).toBe(true)
  })
})
