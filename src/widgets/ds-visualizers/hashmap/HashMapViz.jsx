import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'
import Widget from '../Widget.jsx'

/**
 * HashMapViz — hash table with separate chaining.
 *
 * Props:
 *   buckets   (array of arrays of { key, value }) — buckets[i] = entries at slot i
 *   size      total number of buckets (derived if omitted)
 *   highlight string — key to highlight across buckets
 *   title     widget header title
 */
export default function HashMapViz({
  buckets = [],
  size,
  highlight = null,
  title = 'Tabla hash',
}) {
  const total = size ?? buckets.length
  const rows = Array.from({ length: total }, (_, i) => buckets[i] || [])
  const entryCount = rows.reduce((n, r) => n + r.length, 0)

  const meta = (
    <span className="chip chip--muted">
      {entryCount} / {total} buckets
    </span>
  )

  return (
    <Widget title={title} subtitle="HASH TABLE" meta={meta} noFooter>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {rows.map((entries, i) => (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <div
              style={{
                width: 32,
                padding: '6px 0',
                textAlign: 'center',
                color: 'var(--fg-4)',
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                flexShrink: 0,
              }}
            >
              {i}
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flexWrap: 'wrap',
              }}
            >
              {entries.length === 0 && (
                <span style={{ color: 'var(--fg-5)', fontSize: 11 }}>—</span>
              )}
              {entries.map((e, j) => {
                const isHi = e.key === highlight
                return (
                  <Fragment key={j}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'baseline',
                        gap: 4,
                        padding: '4px 10px',
                        background: isHi
                          ? 'var(--accent-soft-bg)'
                          : 'var(--bg-elev-1)',
                        color: 'var(--fg-1)',
                        border: `1px solid ${
                          isHi ? 'var(--accent)' : 'var(--border-default)'
                        }`,
                        borderRadius: 'var(--radius-sm)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ color: 'var(--accent-fg)' }}>{e.key}</span>
                      <span style={{ color: 'var(--fg-4)' }}>→</span>
                      <span>{String(e.value)}</span>
                    </div>
                    {j < entries.length - 1 && (
                      <ArrowRight
                        size={12}
                        style={{ color: 'var(--fg-5)' }}
                      />
                    )}
                  </Fragment>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Widget>
  )
}
