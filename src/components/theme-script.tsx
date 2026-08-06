'use client'

/**
 * Aplica o tema salvo antes da primeira pintura, evitando o flash de branco
 * antes de virar escuro (FOUC classico de dark mode).
 *
 * Precisa de 'use client': o Next 16 recusa <script> renderizado no servidor
 * (o script nunca executaria na hidratacao do cliente). Como Client Component,
 * o React nao tenta renderizar no servidor, e o <script> cru no <head> roda
 * antes de qualquer hidratacao.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}})()`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeInit }} />
}
