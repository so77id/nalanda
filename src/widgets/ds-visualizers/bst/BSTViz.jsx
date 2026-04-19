import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus, Trash2 } from 'lucide-react'
import Widget from '../Widget.jsx'

// --- tree ops (pure, immutable) -------------------------------------------
let __bstId = 0
const nextNodeId = () => ++__bstId

function insertNode(node, value) {
  if (!node) return { id: nextNodeId(), value, left: null, right: null }
  if (value === node.value) return node // reject duplicates
  if (value < node.value) return { ...node, left: insertNode(node.left, value) }
  return { ...node, right: insertNode(node.right, value) }
}

function findMin(node) {
  while (node.left) node = node.left
  return node
}

function removeNode(node, value) {
  if (!node) return null
  if (value < node.value) return { ...node, left: removeNode(node.left, value) }
  if (value > node.value) return { ...node, right: removeNode(node.right, value) }
  if (!node.left && !node.right) return null
  if (!node.left) return node.right
  if (!node.right) return node.left
  // two children — in-order successor takes the slot, keeping its id so
  // the student sees the successor physically rise to fill the gap.
  const succ = findMin(node.right)
  return {
    ...succ,
    left: node.left,
    right: removeNode(node.right, succ.value),
  }
}

function contains(node, value) {
  if (!node) return false
  if (value === node.value) return true
  return contains(value < node.value ? node.left : node.right, value)
}

function count(node) {
  if (!node) return 0
  return 1 + count(node.left) + count(node.right)
}

// --- layout ---------------------------------------------------------------
function computeLayout(root) {
  const placed = []
  const edges = []
  let x = 0
  let maxDepth = -1

  function walk(node, depth) {
    if (!node) return null
    walk(node.left, depth + 1)
    const myX = x++
    if (depth > maxDepth) maxDepth = depth
    placed.push({ id: node.id, value: node.value, x: myX, y: depth })
    walk(node.right, depth + 1)
    return myX
  }

  function collectEdges(node) {
    if (!node) return
    if (node.left) {
      edges.push({
        id: `${node.id}-L-${node.left.id}`,
        from: node.id,
        to: node.left.id,
      })
      collectEdges(node.left)
    }
    if (node.right) {
      edges.push({
        id: `${node.id}-R-${node.right.id}`,
        from: node.id,
        to: node.right.id,
      })
      collectEdges(node.right)
    }
  }

  walk(root, 0)
  collectEdges(root)

  return { nodes: placed, edges, width: x, height: maxDepth + 1 }
}

const NODE_SIZE = 42
const GAP_X = 18
const GAP_Y = 60
const PAD = 20

function nodeCenter(x, y) {
  return {
    cx: PAD + x * (NODE_SIZE + GAP_X) + NODE_SIZE / 2,
    cy: PAD + y * GAP_Y + NODE_SIZE / 2,
  }
}

export default function BSTViz({
  initialValues = [5, 3, 8, 1, 4, 7, 9],
  maxNodes = 15,
  title = 'Árbol binario de búsqueda',
}) {
  const [root, setRoot] = useState(() => {
    let r = null
    for (const v of initialValues) r = insertNode(r, v)
    return r
  })
  const [valueInput, setValueInput] = useState('')
  const [error, setError] = useState('')

  const size = useMemo(() => count(root), [root])
  const { nodes, edges, width, height } = useMemo(
    () => computeLayout(root),
    [root]
  )

  const nodeById = useMemo(() => {
    const m = new Map()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  const canvasW = Math.max(1, width) * (NODE_SIZE + GAP_X) + PAD * 2 - GAP_X
  const canvasH = Math.max(1, height) * GAP_Y + PAD * 2 - GAP_Y + NODE_SIZE

  const doInsert = useCallback(() => {
    const v = parseInt(valueInput, 10)
    if (Number.isNaN(v)) {
      setError('Ingresá un número')
      return
    }
    if (size >= maxNodes) {
      setError(`Máx ${maxNodes} nodos`)
      return
    }
    if (contains(root, v)) {
      setError(`${v} ya está en el árbol`)
      return
    }
    setRoot((r) => insertNode(r, v))
    setValueInput('')
    setError('')
  }, [valueInput, root, size, maxNodes])

  const doRemove = useCallback(() => {
    const v = parseInt(valueInput, 10)
    if (Number.isNaN(v)) {
      setError('Ingresá un número')
      return
    }
    if (!contains(root, v)) {
      setError(`${v} no está en el árbol`)
      return
    }
    setRoot((r) => removeNode(r, v))
    setValueInput('')
    setError('')
  }, [valueInput, root])

  const doClear = useCallback(() => {
    setRoot(null)
    setError('')
  }, [])

  const countChip = (
    <span className="chip chip--muted">
      {size} / {maxNodes}
    </span>
  )

  const controls = (
    <>
      <input
        type="number"
        className="input"
        style={{ width: 80 }}
        value={valueInput}
        onChange={(e) => setValueInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') doInsert()
        }}
        placeholder="valor"
      />
      <button
        type="button"
        className="btn btn--primary"
        onClick={doInsert}
      >
        <Plus size={14} /> insertar
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={doRemove}
      >
        <Minus size={14} /> eliminar
      </button>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="btn btn--ghost"
        onClick={doClear}
        disabled={root === null}
      >
        <Trash2 size={14} /> limpiar
      </button>
    </>
  )

  return (
    <Widget
      title={title}
      subtitle="BST"
      meta={countChip}
      controls={controls}
      error={error}
      dataViz="bst"
    >
      {root === null ? (
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
        <div style={{ overflowX: 'auto' }}>
          <div
            style={{ position: 'relative', margin: '0 auto', width: canvasW, height: canvasH }}
          >
            <svg
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              width={canvasW}
              height={canvasH}
            >
              {edges.map((e) => {
                const from = nodeById.get(e.from)
                const to = nodeById.get(e.to)
                if (!from || !to) return null
                const a = nodeCenter(from.x, from.y)
                const b = nodeCenter(to.x, to.y)
                return (
                  <line
                    key={e.id}
                    x1={a.cx}
                    y1={a.cy}
                    x2={b.cx}
                    y2={b.cy}
                    stroke="var(--border-default)"
                    strokeWidth="1.5"
                  />
                )
              })}
            </svg>
            <AnimatePresence initial={false} mode="popLayout">
              {nodes.map((n) => {
                const { cx, cy } = nodeCenter(n.x, n.y)
                const left = cx - NODE_SIZE / 2
                const top = cy - NODE_SIZE / 2
                return (
                  <motion.div
                    key={n.id}
                    data-cell={n.value}
                    initial={{ opacity: 0, scale: 0.3, x: left, y: top }}
                    animate={{ opacity: 1, scale: 1, x: left, y: top }}
                    exit={{ opacity: 0, scale: 0.3 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    style={{
                      position: 'absolute',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--bg-elev-1)',
                      border: '1.5px solid var(--border-default)',
                      color: 'var(--fg-1)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                      borderRadius: 'var(--radius-full)',
                      width: NODE_SIZE,
                      height: NODE_SIZE,
                      top: 0,
                      left: 0,
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    {n.value}
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
