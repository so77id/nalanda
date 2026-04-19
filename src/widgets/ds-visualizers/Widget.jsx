/**
 * Widget — Generic frame for every data-structure visualization.
 *
 *   ┌── header ─────────────────────────┐  title · language · meta
 *   │  body (the viz)                   │
 *   └── footer (controls) ──────────────┘
 *
 * Props:
 *   title      string       left-side title in the header
 *   subtitle   string       dim mono label next to the title
 *   language   string       e.g. "python" — shown as a muted chip
 *   meta       ReactNode    right-side header content (chips, counters)
 *   controls   ReactNode    footer content (alias: footer)
 *   footer     ReactNode    alias for controls
 *   error      string       optional error strip above the footer
 *   chromeless bool         hide the header entirely
 *   noFooter   bool         hide the footer entirely
 *   padding    "sm"|"md"|"lg"|"none"
 */
export default function Widget({
  title,
  subtitle,
  language,
  meta,
  controls,
  footer,
  error,
  chromeless = false,
  noFooter = false,
  padding = 'md',
  className = '',
  dataViz,
  children,
}) {
  const footerContent = controls ?? footer
  const pad = { none: 0, sm: 12, md: 20, lg: 28 }[padding] ?? 20

  return (
    <div
      className={`nalanda not-prose my-6 ${className}`}
      data-viz={dataViz}
    >
      <div className="card">
        {!chromeless && (
          <div className="card__header">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 0,
                flex: 1,
              }}
            >
              {title && (
                <span
                  style={{
                    color: 'var(--fg-1)',
                    fontWeight: 500,
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  {title}
                </span>
              )}
              {subtitle && (
                <span className="chrome-label" style={{ minWidth: 0 }}>
                  {subtitle}
                </span>
              )}
              {language && (
                <span className="chip chip--muted" style={{ fontSize: 10 }}>
                  {language}
                </span>
              )}
            </div>
            {meta && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {meta}
              </div>
            )}
          </div>
        )}

        <div className="card__body" style={{ padding: pad }}>
          {children}
        </div>

        {error && (
          <div
            data-role="error"
            style={{
              background: 'var(--warn-bg)',
              color: 'var(--warn-fg)',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: 'var(--text-xs)',
              padding: '6px 14px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {error}
          </div>
        )}

        {!noFooter && footerContent && (
          <div className="card__footer">{footerContent}</div>
        )}
      </div>
    </div>
  )
}
