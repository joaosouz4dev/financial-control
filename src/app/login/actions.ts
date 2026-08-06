'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/auth'

/**
 * Server Action de login. Devolve uma mensagem em vez de deixar o erro vazar,
 * e nunca diz se foi o email ou a senha que errou (nao entregar quais emails
 * existem).
 */
export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: '/',
    })
    return null
  } catch (e) {
    // signIn lanca um redirect em caso de sucesso: precisa ser repropagado.
    if (e instanceof AuthError) {
      return { error: 'Email ou senha incorretos.' }
    }
    throw e
  }
}
