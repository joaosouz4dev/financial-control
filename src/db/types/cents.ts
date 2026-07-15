import { customType } from 'drizzle-orm/pg-core'

/**
 * Dinheiro em centavos. Postgres bigint volta como string no driver, e deixar
 * essa string vazar para a aplicacao e onde nasce a diferenca de centavo:
 * todo calculo vira parse -> float -> round.
 *
 * O teto seguro do JS (2^53) equivale a ~90 trilhoes de reais em centavos.
 */
export const cents = customType<{ data: number; driverData: string }>({
  dataType: () => 'bigint',
  fromDriver: (value) => {
    const n = Number(value)
    if (!Number.isSafeInteger(n)) {
      throw new Error(`Valor em centavos fora do range seguro do JS: ${value}`)
    }
    return n
  },
  toDriver: (value) => {
    if (!Number.isFinite(value)) {
      throw new Error(`Valor em centavos invalido: ${value}`)
    }
    return String(Math.round(value))
  },
})
