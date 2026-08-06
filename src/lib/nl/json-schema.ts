import { z } from 'zod'

/**
 * Zod 4 gera JSON Schema nativamente, mas nao emite `additionalProperties`.
 * Sem `additionalProperties: false` em todo objeto, `strict: true` na tool e
 * rejeitado, e strict e justamente o que garante que o input da tool valida
 * exatamente contra o schema. Sem ele, o modelo pode inventar um campo e a
 * validacao so pegaria depois.
 */
/** O formato que a Messages API espera em `tools[].input_schema`. */
export interface InputSchema {
  type: 'object'
  properties?: Record<string, unknown> | null
  required?: string[]
  additionalProperties?: boolean
  [k: string]: unknown
}

export function zodToJsonSchema(schema: z.ZodType): InputSchema {
  const raw = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
    // $ref confunde o modelo e nao ganha nada num schema deste tamanho.
    reused: 'inline',
  }) as Record<string, unknown>

  return closeObjects(raw) as InputSchema
}

/** Fecha todo objeto do schema recursivamente. */
function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects)
  if (node === null || typeof node !== 'object') return node

  const obj = node as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(obj)) {
    out[k] = closeObjects(v)
  }

  if (out.type === 'object' && out.properties && out.additionalProperties === undefined) {
    out.additionalProperties = false
  }

  return out
}
