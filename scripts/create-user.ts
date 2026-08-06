import 'dotenv/config'
import { hash } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users } from '../src/db/schema'

/**
 * Cria (ou atualiza a senha de) um usuario.
 *
 *   pnpm tsx scripts/create-user.ts email@exemplo.com "minha senha"
 *
 * A senha vem por argumento e vira hash argon2 antes de tocar o banco: o texto
 * puro nunca e gravado. Sem cadastro aberto no app, este script e o unico
 * jeito de criar conta.
 */
async function main() {
  const [email, password, name] = process.argv.slice(2)

  if (!email || !password) {
    console.error('Uso: pnpm tsx scripts/create-user.ts <email> <senha> [nome]')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('A senha precisa ter ao menos 8 caracteres.')
    process.exit(1)
  }

  const passwordHash = await hash(password)
  const normalizedEmail = email.toLowerCase().trim()

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (existing) {
    await db.update(users).set({ passwordHash }).where(eq(users.id, existing.id))
    console.log(`Senha atualizada para ${normalizedEmail}`)
  } else {
    await db.insert(users).values({ email: normalizedEmail, name: name ?? null, passwordHash })
    console.log(`Usuario criado: ${normalizedEmail}`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
