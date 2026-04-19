import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

const STORAGE_KEY = 'nalanda-theme'

function readInitialTheme() {
  if (typeof document === 'undefined') return 'dark'
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' ? 'light' : 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {}
  }, [theme])

  return [theme, setTheme]
}

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className={`btn btn--secondary btn--icon ${className}`}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
