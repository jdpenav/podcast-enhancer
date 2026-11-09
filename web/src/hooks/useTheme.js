import { useCallback, useEffect, useState } from 'react'

// Tema: 'system' (sigue al sistema operativo), 'light' o 'dark'. Se recuerda en este navegador.
// index.html aplica el tema guardado antes de pintar, para que no parpadee al cargar.
const KEY = 'enhancer-theme'
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function read() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(theme) {
  const dark = theme === 'dark' || (theme === 'system' && media?.matches)
  document.documentElement.classList.toggle('dark', !!dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setThemeState] = useState(read)

  useEffect(() => {
    apply(theme)
    if (theme !== 'system' || !media) return
    // En "Sistema", seguir los cambios del sistema operativo en vivo
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t) => {
    try {
      if (t === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, t)
    } catch {
      // sin almacenamiento (modo privado estricto): funciona igual, solo no se recuerda
    }
    setThemeState(t)
  }, [])

  return { theme, setTheme }
}
