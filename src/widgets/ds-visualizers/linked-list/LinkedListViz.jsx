import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { VizFrame, VizBody, VizControls } from '../VizFrame.jsx'

export default function LinkedListViz({
  initialValues = [],
  maxNodes = 12,
}) {
  const [nodes, setNodes] = useState(() =>
    initialValues.map((v, i) => ({ id: i + 1, value: v }))
  )
  const [nextId, setNextId] = useState(initialValues.length + 1)
  const [valueInput, setValueInput] = useState('')
  const [indexInput, setIndexInput] = useState('')
  const [error, setError] = useState('')

  const parseValue = () => {
    const v = parseInt(valueInput, 10)
    if (Number.isNaN(v)) {
      setError('Ingresá un número')
      return null
    }
    if (nodes.length >= maxNodes) {
      setError(`Máx ${maxNodes} nodos`)
      return null
    }
    return v
  }

  const pushFront = useCallback(() => {
    const v = parseValue()
    if (v === null) return
    setNodes((prev) => [{ id: nextId, value: v }, ...prev])
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, nodes.length, nextId, maxNodes])

  const pushBack = useCallback(() => {
    const v = parseValue()
    if (v === null) return
    setNodes((prev) => [...prev, { id: nextId, value: v }])
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, nodes.length, nextId, maxNodes])

  const removeAt = useCallback(() => {
    const i = parseInt(indexInput, 10)
    if (Number.isNaN(i) || i < 0 || i >= nodes.length) {
      setError(`Índice inválido (0..${nodes.length - 1})`)
      return
    }
    setNodes((prev) => prev.filter((_, idx) => idx !== i))
    setIndexInput('')
    setError('')
  }, [indexInput, nodes.length])

  const clear = useCallback(() => {
    setNodes([])
    setError('')
  }, [])

  return (
    <VizFrame
      label="linked list"
      count={nodes.length}
      max={maxNodes}
      error={error}
    >
      <VizBody>
        <div className="flex flex-wrap items-center gap-2 min-h-[4.5rem]">
          <span className="text-xs font-mono text-fuchsia-400 mr-1">
            head →
          </span>
          {nodes.length === 0 && (
            <span className="text-slate-500 font-mono italic text-sm">
              NULL
            </span>
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            {nodes.map((node, i) => (
              <motion.div
                key={node.id}
                layout
                initial={{ opacity: 0, scale: 0.3, y: -24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.3, y: 24 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="flex items-center gap-2"
              >
                <div className="relative flex flex-col items-center">
                  <div className="rounded-md bg-slate-800 border border-slate-700 px-3 py-1.5 font-mono text-slate-100 shadow-md min-w-[2.5rem] text-center">
                    {node.value}
                  </div>
                  <span className="absolute -bottom-4 text-[9px] text-slate-500 font-mono">
                    [{i}]
                  </span>
                </div>
                <span className="text-slate-600 text-lg">→</span>
              </motion.div>
            ))}
            {nodes.length > 0 && (
              <motion.span
                key="null-tail"
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-slate-500 font-mono text-sm"
              >
                NULL
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </VizBody>

      <VizControls>
        <input
          type="number"
          value={valueInput}
          onChange={(e) => setValueInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') pushBack()
          }}
          placeholder="valor"
          className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm outline-none focus:border-fuchsia-500 transition"
        />
        <button
          onClick={pushFront}
          className="rounded bg-fuchsia-500 px-3 py-1 text-sm font-medium text-white hover:bg-fuchsia-400 transition"
          title="Insert at head"
        >
          + front
        </button>
        <button
          onClick={pushBack}
          className="rounded bg-fuchsia-500 px-3 py-1 text-sm font-medium text-white hover:bg-fuchsia-400 transition"
          title="Insert at tail"
        >
          + back
        </button>

        <div className="flex items-center gap-1 ml-2 pl-3 border-l border-slate-800">
          <input
            type="number"
            value={indexInput}
            onChange={(e) => setIndexInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') removeAt()
            }}
            placeholder="idx"
            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm outline-none focus:border-fuchsia-500 transition"
          />
          <button
            onClick={removeAt}
            className="rounded bg-slate-700 px-3 py-1 text-sm font-medium text-slate-100 hover:bg-slate-600 transition"
          >
            remove
          </button>
        </div>

        <button
          onClick={clear}
          disabled={nodes.length === 0}
          className="ml-auto rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition"
        >
          clear
        </button>
      </VizControls>
    </VizFrame>
  )
}
