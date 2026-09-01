import { redirect } from 'next/navigation'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { listMonths } from '@/lib/queries'
import { TZ } from '@/lib/nl/resolve'

dayjs.extend(utc)
dayjs.extend(timezone)

export const dynamic = 'force-dynamic'

/**
 * Entra no mes corrente.
 *
 * Antes entrava no ultimo mes que TINHA lancamento, entao quando setembro virou
 * o app continuou mostrando agosto: o mes novo nao existia porque nada o havia
 * aberto. Agora o destino e o mes de hoje, e /m/[month] cuida de abri-lo.
 */
export default async function Home() {
  const hoje = dayjs().tz(TZ).format('YYYY-MM')
  const months = await listMonths()

  // Sem nenhum dado ainda e sem recorrencia para abrir: tela de vazio.
  if (months.length === 0) redirect('/vazio')

  redirect(`/m/${hoje}`)
}
