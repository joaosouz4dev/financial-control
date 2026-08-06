import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { verify } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { users } from '@/db/schema'
import { authConfig } from './auth.config'

/**
 * Config COMPLETA: roda so no Node (nunca no Edge), porque usa argon2 nativo e
 * o driver do Postgres. O middleware usa a versao leve em auth.config.ts.
 *
 * Sem cadastro aberto: contas sao criadas por `pnpm user:create`. A senha
 * nunca e comparada em texto, o hash argon2 fica no banco.
 */

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(raw) {
        const parsed = CredentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        const { email, password } = parsed.data
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1)

        if (!user?.passwordHash) return null

        const ok = await verify(user.passwordHash, password)
        if (!ok) return null

        return { id: user.id, email: user.email, name: user.name }
      },
    }),
  ],
})
