import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { hash, verify } from '@node-rs/argon2'
import { auth } from '@/auth'
import { db } from '@/db'
import { users } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Altera email e/ou senha da conta logada.
 *
 * Sempre exige a senha ATUAL, mesmo para trocar so o email: sem isso, quem
 * pegasse a sessao aberta trocaria as credenciais e tomaria a conta.
 */
const PatchSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    email: z.string().email('Email inválido').optional(),
    newPassword: z.string().min(8, 'A nova senha precisa ter ao menos 8 caracteres').optional(),
  })
  .refine((d) => d.email || d.newPassword, {
    message: 'Informe um novo email ou uma nova senha',
  })

export async function PATCH(req: Request) {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let parsed
  try {
    parsed = PatchSchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }

  const { currentPassword, email, newPassword } = parsed.data

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user?.passwordHash) {
    return NextResponse.json({ error: 'Conta sem senha configurada' }, { status: 400 })
  }

  const ok = await verify(user.passwordHash, currentPassword)
  if (!ok) return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 403 })

  const update: Record<string, unknown> = {}

  if (email) {
    const normalized = email.toLowerCase().trim()
    if (normalized !== user.email) {
      const [taken] = await db.select().from(users).where(eq(users.email, normalized)).limit(1)
      if (taken) return NextResponse.json({ error: 'Esse email já está em uso.' }, { status: 409 })
      update.email = normalized
    }
  }

  if (newPassword) update.passwordHash = await hash(newPassword)

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, changed: false })
  }

  await db.update(users).set(update).where(eq(users.id, userId))

  return NextResponse.json({
    ok: true,
    changed: true,
    // Trocar email ou senha invalida a sessao: o usuario precisa entrar de novo.
    requiresRelogin: true,
  })
}
