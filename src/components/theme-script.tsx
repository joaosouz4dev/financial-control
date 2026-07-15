/**
 * Aplica o tema antes da primeira pintura. Sem isto o app pisca branco
 * antes de virar escuro (FOUC), que e o defeito classico de dark mode.
 * Roda inline no <head>, antes do React hidratar.
 */
export function ThemeScript() {
  const code = `
    (function () {
      try {
        var stored = localStorage.getItem('theme')
        if (stored === 'dark' || stored === 'light') {
          document.documentElement.dataset.theme = stored
        }
      } catch (e) {}
    })()
  `
  return <script dangerouslySetInnerHTML={{ __html: code }} />
}
