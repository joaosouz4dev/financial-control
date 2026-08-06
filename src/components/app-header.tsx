'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from './theme-toggle'
import styles from './app-header.module.css'

/**
 * Header unico de todas as telas.
 *
 * Antes cada pagina tinha seu proprio cabecalho: o dashboard com o menu, as
 * outras so com uma seta de voltar. Navegar entre elas parecia trocar de app.
 * Aqui o menu e sempre o mesmo e a rota atual fica marcada.
 */

/* Sem `as const` no array: com typedRoutes, colapsar os href numa uniao faz o
 * Link rejeitar o valor. Cada item mantem seu literal proprio. */
const LINKS = [
  { href: '/' as const, label: 'Mês' },
  { href: '/chat' as const, label: 'Chat' },
  { href: '/historico' as const, label: 'Histórico' },
  { href: '/metas' as const, label: 'Metas' },
  { href: '/planos' as const, label: 'Planos' },
  { href: '/conta' as const, label: 'Conta' },
]

export function AppHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  /** Controles proprios da tela, como a navegacao de meses. */
  children?: React.ReactNode
}) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/m/') : pathname.startsWith(href)

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Link href="/" className={styles.logo} aria-label="Início">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 17l5-5 4 3 8-8" />
            <path d="M16 7h5v5" />
          </svg>
        </Link>
        <div className={styles.titles}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
      </div>

      <div className={styles.right}>
        {children}
        <nav className={styles.nav} aria-label="Seções">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`${styles.navLink} ${isActive(l.href) ? styles.active : ''}`}
              aria-current={isActive(l.href) ? 'page' : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  )
}
