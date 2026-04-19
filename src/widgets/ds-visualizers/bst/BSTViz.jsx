import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { VizFrame, VizBody, VizControls } from '../VizFrame.jsx'

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
  // found
  if (!node.left && !node.right) return null
  if (!node.left) return node.right
  if (!node.right) return node.left
  // two children — promote the in-order successor, keep successor's id so the
  // student sees the successor node physically rise to take the slot
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

// --- component ------------------------------------------------------------
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

  return (
    <VizFrame label="bst" count={size} max={maxNodes} error={error}>
      <VizBody>
        {root === null ? (
          <p className="text-slate-500 font-mono italic text-sm text-center py-4">
            empty — insertá un valor para empezar
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="relative mx-auto"
              style={{ width: canvasW, height: canvasH }}
            >
              <svg
                className="absolute inset-0 pointer-events-none"
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
                      stroke="rgb(71 85 105)"
                      strokeWidth="2"
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
                      initial={{ opacity: 0, scale: 0.3, x: left, y: top }}
                      animate={{ opacity: 1, scale: 1, x: left, y: top }}
                      exit={{ opacity: 0, scale: 0.3 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 font-mono text-sm text-slate-100 shadow-md"
                      style={{ width: NODE_SIZE, height: NODE_SIZE, top: 0, left: 0 }}
                    >
                      {n.value}
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        )}
      </VizBody>

      <VizControls>
        <input
          type="number"
          value={valueInput}
          onChange={(e) => setValueInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doInsert()
          }}
          placeholder="valor"
          className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm outline-none focus:border-fuchsia-500 transition"
        />
        <button
          onClick={doInsert}
          className="rounded bg-fuchsia-500 px-3 py-1 text-sm font-medium text-white hover:bg-fuchsia-400 transition"
        >
          insert
        </button>
        <button
          onClick={doRemove}
          className="rounded bg-slate-700 px-3 py-1 text-sm font-medium text-slate-100 hover:bg-slate-600 transition"
        >
          delete
        </button>

        <button
          onClick={doClear}
          disabled={root === null}
          className="ml-auto rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition"
        >
          clear
        </button>
      </VizControls>
    </VizFrame>
  )
}
