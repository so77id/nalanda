import { useId } from 'react'
import Widget from '../Widget.jsx'

/**
 * GraphViz — circular-layout graph.
 *
 * Props:
 *   nodes      array of { id, label? }
 *   edges      array of { from, to, weight?, directed? }
 *   highlight  Set of node ids to highlight
 *   directed   bool — draw arrowheads on every edge (can be overridden per edge)
 *   title      widget header title
 *
 * Layout: nodes placed on a circle. Good for ≤12 nodes. For larger graphs,
 * swap in a force-directed layout.
 */
export default function GraphViz({
  nodes = [],
  edges = [],
  highlight = new Set(),
  directed = false,
  title = 'Grafo',
}) {
  const W = 420
  const H = 280
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 34
  const NODE_R = 20

  const positioned = nodes.map((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2
    return {
      ...n,
      x: cx + Math.cos(angle) * R,
      y: cy + Math.sin(angle) * R,
    }
  })
  const byId = Object.fromEntries(positioned.map((n) => [n.id, n]))

  const arrowId = `graph-arrow-${useId()}`

  const meta = (
    <span className="chip chip--muted">
      V={nodes.length} · E={edges.length}
    </span>
  )

  return (
    <Widget title={title} subtitle="GRAPH" meta={meta} noFooter>
      <svg
        width={W}
        height={H}
        style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
      >
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-4)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = byId[e.from]
          const b = byId[e.to]
          if (!a || !b) return null
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.hypot(dx, dy) || 1
          const ux = dx / len
          const uy = dy / len
          const x1 = a.x + ux * NODE_R
          const y1 = a.y + uy * NODE_R
          const x2 = b.x - ux * NODE_R
          const y2 = b.y - uy * NODE_R
          const isDir = e.directed ?? directed
          return (
            <g key={i}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--border-default)"
                strokeWidth="1.5"
                markerEnd={isDir ? `url(#${arrowId})` : undefined}
              />
              {e.weight !== undefined && (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 4}
                  fontFamily="var(--font-mono)"
                  fontSize="11"
                  fill="var(--fg-3)"
                  textAnchor="middle"
                >
                  {e.weight}
                </text>
              )}
            </g>
          )
        })}
        {positioned.map((n) => {
          const isHi = highlight.has ? highlight.has(n.id) : false
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              <circle
                r={NODE_R}
                fill={isHi ? 'var(--accent-soft-bg)' : 'var(--bg-elev-1)'}
                stroke={isHi ? 'var(--accent)' : 'var(--border-default)'}
                strokeWidth={isHi ? 2 : 1.5}
              />
              <text
                y="5"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="13"
                fill={isHi ? 'var(--accent-fg)' : 'var(--fg-1)'}
              >
                {n.label ?? n.id}
              </text>
            </g>
          )
        })}
      </svg>
    </Widget>
  )
}
