import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from './auth.config'

/**
 * Bloqueia TUDO sem sessao, exceto a pagina de login e a rota do Auth.js.
 *
 * Esta e a garantia real de que os dados nao vazam: sem ela, cada pagina
 * precisaria lembrar de checar login, e uma pagina esquecida exporia quatro
 * anos de financas. Negar por padrao e liberar o minimo e o caminho seguro.
 *
 * Usa a config LEVE (auth.config): o middleware roda no Edge Runtime, que nao
 * suporta o argon2 nativo nem o driver do Postgres da config completa.
 */
const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth')

  if (!isLoggedIn && !isPublic) {
    // API responde 401; navegacao redireciona para o login.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    const url = new URL('/login', req.nextUrl.origin)
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)'],
}
