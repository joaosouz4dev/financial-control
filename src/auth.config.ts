import type { NextAuthConfig } from 'next-auth'

/**
 * Config LEVE, sem provider e sem acesso a banco.
 *
 * O middleware roda no Edge Runtime, que nao suporta binario nativo: se ele
 * importasse a config completa, o argon2 (nativo) e o driver do Postgres
 * seriam arrastados para o Edge e o build quebra com "Module not found:
 * @node-rs/argon2-wasm32-wasi".
 *
 * Entao o middleware usa so isto (paginas + callbacks de sessao), e a config
 * completa com Credentials fica em auth.ts, que so roda no Node.
 */
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [], // preenchido em auth.ts
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id
      return token
    },
    session({ session, token }) {
      if (token.uid && session.user) {
        ;(session.user as { id?: string }).id = token.uid as string
      }
      return session
    },
  },
} satisfies NextAuthConfig
