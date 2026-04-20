import { Sun, Moon } from 'lucide-react'
import { useTheme } from './ThemeContext.jsx'

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
