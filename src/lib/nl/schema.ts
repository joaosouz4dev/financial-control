import { z } from 'zod'

/**
 * Schema da extracao por escrita humana.
 *
 * As tres decisoes que carregam o design:
 *
 * 1. `asWritten: string`, nao `amountCents: number`. Se a tool pedisse numero,
 *    o modelo CALCULA, e "550 por semana" vira o que ele decidir. Pedindo
 *    string ele copia "550" e o TypeScript faz a conta com Decimal. Isso
 *    elimina a classe inteira de "a LLM inventou o numero".
 *
 * 2. `dateRef` como union, nao `date: string`. Se pedissemos ISO, o modelo
 *    precisaria saber que dia e hoje, e a data iria para o system prompt,
 *    quebrando o cache. Nomeando a referencia, o prompt fica congelado e o
 *    servidor resolve o fuso.
 *
 * 3. `intent`, nao so transacao. "netflix subiu pra 59,90" NAO e um gasto: e
 *    UPDATE no valor esperado da regra. Sem isso, lancamos 59,90 hoje e a
 *    regra continua em 44,90, e o detector de variacao nunca dispara. E o bug
 *    que mata o produto em silencio.
 */

export const AmountSchema = z.object({
  asWritten: z
    .string()
    .describe(
      'O valor exatamente como aparece no texto do usuario: "90", "550", "59,90", "R$ 1.850". ' +
        'Copie os caracteres literalmente. NAO converta, NAO arredonde, NAO calcule.',
    ),
  impliesMath: z
    .boolean()
    .describe(
      'True se transformar isso em um valor unico exigiria aritmetica ("550 por semana" -> mensal, ' +
        '"3x de 200"). A aplicacao faz a conta, voce nao.',
    ),
  mathNote: z
    .string()
    .nullable()
    .describe(
      'Se impliesMath, descreva a operacao em palavras: "semanal, multiplicar por 4". ' +
        'Nunca escreva o resultado.',
    ),
})

export const DateRefSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('today') }),
    z.object({ type: z.literal('yesterday') }),
    z.object({ type: z.literal('relative_days'), daysAgo: z.number().int().min(0).max(400) }),
    z.object({ type: z.literal('last_week') }),
    z.object({ type: z.literal('this_month') }),
    z.object({ type: z.literal('last_month') }),
    z.object({ type: z.literal('explicit'), iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    z.object({ type: z.literal('day_only'), day: z.number().int().min(1).max(31) }),
    z.object({ type: z.literal('unspecified') }),
  ])
  .describe('Como o usuario se referiu ao tempo. NAO calcule a data: nomeie a referencia.')

export const TransactionSchema = z.object({
  kind: z.enum(['income', 'expense']),
  amount: AmountSchema,
  labelHint: z
    .string()
    .describe(
      'O nome como o usuario escreveu, em minusculas, sem acrescentar nada: ' +
        '"agua", "netflix", "vansa", "marmore", "socios yt prime".',
    ),
  dateRef: DateRefSchema,
  recurrence: z.enum(['one_off', 'weekly', 'biweekly', 'monthly', 'yearly', 'unclear']),
  intent: z
    .enum(['record', 'price_change', 'new_recurring', 'cancel'])
    .describe(
      'O que o usuario esta fazendo. "netflix subiu pra 59,90" e price_change, NAO record. ' +
        'Errar isso e pior que errar o valor.',
    ),
  installment: z
    .object({ current: z.number().int(), total: z.number().int() })
    .nullable()
    .describe('So se o usuario escreveu explicitamente, ex "Marmore 5/6" -> {current:5,total:6}.'),
  confidence: z.number().min(0).max(1),
  ambiguity: z
    .string()
    .nullable()
    .describe(
      'Se algo for genuinamente ambiguo, escreva a pergunta em portugues, no registro dele. ' +
        'Null se estiver claro.',
    ),
})

export const ExtractionSchema = z.object({
  transactions: z.array(TransactionSchema).min(1),
})

export type Amount = z.infer<typeof AmountSchema>
export type DateRef = z.infer<typeof DateRefSchema>
export type ExtractedTransaction = z.infer<typeof TransactionSchema>
export type Extraction = z.infer<typeof ExtractionSchema>
