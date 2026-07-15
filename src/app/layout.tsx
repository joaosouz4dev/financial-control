import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import { ThemeScript } from '@/components/theme-script'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Controle Financeiro',
  description: 'Contratos, recorrência, metas e conselhos. Sem planilha.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0a14' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // As variaveis de fonte vao no <html>: --font-sans e definida em :root e
    // nao enxerga variavel declarada no <body>, o que derruba tudo para serif.
    <html lang="pt-BR" className={`${jakarta.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  )
}
