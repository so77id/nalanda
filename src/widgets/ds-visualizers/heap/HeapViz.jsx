import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, ArrowUpFromLine, Trash2 } from 'lucide-react'
import Widget from '../Widget.jsx'

/**
 * HeapViz — interactive binary heap (min or max).
 *
 * Props:
 *   initialValues  number[]  initial level-order contents
 *   type           "min" | "max"
 *   capacity       number    max size; controls disable at limit
 *   title          string
 *   readOnly       bool      hide controls
 */
export default function HeapViz({
  initialValues = [],
  type = 'min',
  capacity = 15,
  title = 'Heap',
  readOnly = false,
}) {
  const buildHeap = useCallback(
    (vals) => {
      const nodes = vals.map((v, i) => ({ id: i + 1, value: v }))
      siftAll(nodes, type)
      return nodes
    },
    [type]
  )

  const [nodes, setNodes] = useState(() => buildHeap(initialValues))
  const [nextId, setNextId] = useState(initialValues.length + 1)
  const [valueInput, setValueInput] = useState('')
  const [error, setError] = useState('')

  const insert = useCallback(() => {
    const v = parseInt(valueInput, 10)
    if (Number.isNaN(v)) {
      setError('Ingresá un número')
      return
    }
    if (nodes.length >= capacity) {
      setError(`Heap lleno (máx ${capacity})`)
      return
    }
    setNodes((prev) => {
      const next = [...prev, { id: nextId, value: v }]
      siftUp(next, next.length - 1, type)
      return next
    })
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, nodes.length, nextId, capacity, type])

  const extract = useCallback(() => {
    if (nodes.length === 0) {
      setError(`Heap vacío`)
      return
    }
    setNodes((prev) => {
      if (prev.length === 1) return []
      const next = [...prev]
      next[0] = next[next.length - 1]
      next.pop()
      siftDown(next, 0, type)
      return next
    })
    setError('')
  }, [nodes.length, type])

  const clear = useCallback(() => {
    setNodes([])
    setError('')
  }, [])

  const positions = useMemo(() => computePositions(nodes), [nodes])
  const { width, height } = positions.box

  const meta = (
    <span className="chip chip--muted">
      {nodes.length} / {capacity}
    </span>
  )

  const controls = !readOnly && (
    <>
      <input
        type="number"
        className="input"
        style={{ width: 80 }}
        value={valueInput}
        onChange={(e) => setValueInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') insert()
        }}
        placeholder="valor"
      />
      <button
        type="button"
        className="btn btn--primary"
        onClick={insert}
      >
        <Plus size={14} /> insertar
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={extract}
        disabled={nodes.length === 0}
        title={`Extraer ${type === 'min' ? 'mínimo' : 'máximo'}`}
      >
        <ArrowUpFromLine size={14} />
        extraer-{type}
      </button>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="btn btn--ghost"
        onClick={clear}
        disabled={nodes.length === 0}
      >
        <Trash2 size={14} /> limpiar
      </button>
    </>
  )

  return (
    <Widget
      title={title}
      subtitle={`${type === 'min' ? 'MIN' : 'MAX'}-HEAP`}
      meta={meta}
      controls={controls}
      error={error}
      dataViz="heap"
    >
      {nodes.length === 0 ? (
        <p
          style={{
            color: 'var(--fg-5)',
            fontFamily: 'var(--font-mono)',
            fontStyle: 'italic',
            fontSize: 'var(--text-sm)',
            textAlign: 'center',
            padding: '16px 0',
            margin: 0,
          }}
        >
          vacío — insertá un valor para empezar
        </p>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <div
            style={{
              position: 'relative',
              margin: '0 auto',
              width,
              height,
            }}
          >
            <svg
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              width={width}
              height={height}
            >
              {positions.list.map((p) => {
                if (p.i === 0) return null
                const parent = Math.floor((p.i - 1) / 2)
                const pp = positions.list[parent]
                return (
                  <line
                    key={`edge-${p.id}`}
                    x1={pp.x}
                    y1={pp.y}
                    x2={p.x}
                    y2={p.y}
                    stroke="var(--border-default)"
                    strokeWidth="1.5"
                  />
                )
              })}
            </svg>
            <AnimatePresence initial={false}>
              {positions.list.map((p) => {
                const isRoot = p.i === 0
                return (
                  <motion.div
                    key={p.id}
                    data-cell={p.value}
                    layout
                    initial={{ opacity: 0, scale: 0.3 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.3 }}
                    transition={{
                      type: 'spring',
                      stiffness: 420,
                      damping: 32,
                    }}
                    style={{
                      position: 'absolute',
                      left: p.x - NODE_R,
                      top: p.y - NODE_R,
                      width: NODE_R * 2,
                      height: NODE_R * 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isRoot
                        ? 'var(--accent-soft-bg)'
                        : 'var(--bg-elev-1)',
                      border: `1.5px solid ${
                        isRoot ? 'var(--accent)' : 'var(--border-default)'
                      }`,
                      color: isRoot ? 'var(--accent-fg)' : 'var(--fg-1)',
                      borderRadius: 'var(--radius-full)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      boxShadow: isRoot ? '0 0 0 3px var(--accent-glow)' : 'var(--shadow-sm)',
                    }}
                  >
                    {String(p.value)}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </Widget>
  )
}

// ---- heap operations (pure) ----------------------------------------------

const NODE_R = 20
const Y_STEP = 64
const PAD = 24

function cmp(a, b, type) {
  return type === 'min' ? a < b : a > b
}

function swap(arr, i, j) {
  const t = arr[i]
  arr[i] = arr[j]
  arr[j] = t
}

function siftUp(arr, i, type) {
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2)
    if (cmp(arr[i].value, arr[parent].value, type)) {
      swap(arr, i, parent)
      i = parent
    } else break
  }
}

function siftDown(arr, i, type) {
  const n = arr.length
  while (true) {
    const l = i * 2 + 1
    const r = i * 2 + 2
    let best = i
    if (l < n && cmp(arr[l].value, arr[best].value, type)) best = l
    if (r < n && cmp(arr[r].value, arr[best].value, type)) best = r
    if (best === i) break
    swap(arr, i, best)
    i = best
  }
}

function siftAll(arr, type) {
  for (let i = Math.floor(arr.length / 2) - 1; i >= 0; i--) {
    siftDown(arr, i, type)
  }
}

// ---- layout --------------------------------------------------------------

function computePositions(nodes) {
  if (nodes.length === 0) {
    return { list: [], box: { width: 0, height: 0 } }
  }
  const depth = Math.floor(Math.log2(nodes.length))
  const bottomWidth = Math.pow(2, depth)
  const X_UNIT = 44
  const width = Math.max(240, bottomWidth * X_UNIT + PAD * 2)
  const height = depth * Y_STEP + PAD * 2 + NODE_R * 2

  const list = nodes.map((n, i) => {
    const lvl = Math.floor(Math.log2(i + 1))
    const idxInLvl = i - (Math.pow(2, lvl) - 1)
    const nodesInLvl = Math.pow(2, lvl)
    const x = PAD + ((idxInLvl + 0.5) / nodesInLvl) * (width - PAD * 2)
    const y = PAD + NODE_R + lvl * Y_STEP
    return { id: n.id, value: n.value, i, x, y }
  })
  return { list, box: { width, height } }
}
