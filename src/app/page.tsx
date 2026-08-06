import { redirect } from 'next/navigation'
import { listMonths } from '@/lib/queries'

export const dynamic = 'force-dynamic'

/** Entra no mes mais recente que tem dado. */
export default async function Home() {
  const months = await listMonths()
  if (months.length === 0) redirect('/vazio')
  redirect(`/m/${months.at(-1)}`)
}
