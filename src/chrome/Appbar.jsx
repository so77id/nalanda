/**
 * Appbar — sticky top bar with brand on the left and actions on the right.
 *
 * Uses a semi-transparent page background plus backdrop-filter blur so
 * content scrolls underneath it. The brand mark is the one sanctioned
 * gradient in the design system.
 *
 *   <Appbar brand="Nalanda" subtitle="Lección 01">
 *     <ThemeToggle />
 *     <Button>Presentar</Button>
 *   </Appbar>
 */
export default function Appbar({ brand = 'Nalanda', subtitle, children }) {
  return (
    <header className="appbar">
      <div className="appbar__brand">
        <span className="appbar__mark">N</span>
        <span className="appbar__name">{brand}</span>
        {subtitle && (
          <span className="appbar__subtitle chrome-label">
            · {subtitle}
          </span>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <div className="appbar__actions">{children}</div>
    </header>
  )
}
