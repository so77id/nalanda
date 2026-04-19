import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeftToLine, ArrowRightToLine, Trash2 } from 'lucide-react'
import Widget from '../Widget.jsx'

export default function LinkedListViz({
  initialValues = [],
  maxNodes = 12,
  title = 'Lista enlazada',
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

  const count = (
    <span className="chip chip--muted">
      {nodes.length} / {maxNodes}
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
          if (e.key === 'Enter') pushBack()
        }}
        placeholder="valor"
      />
      <button
        type="button"
        className="btn btn--primary"
        onClick={pushFront}
        title="Agregar al inicio"
      >
        <ArrowLeftToLine size={14} /> inicio
      </button>
      <button
        type="button"
        className="btn btn--primary"
        onClick={pushBack}
        title="Agregar al final"
      >
        <ArrowRightToLine size={14} /> final
      </button>

      <span
        aria-hidden
        style={{
          width: 1,
          alignSelf: 'stretch',
          background: 'var(--border-subtle)',
          margin: '0 4px',
        }}
      />

      <input
        type="number"
        className="input"
        style={{ width: 64 }}
        value={indexInput}
        onChange={(e) => setIndexInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') removeAt()
        }}
        placeholder="idx"
      />
      <button
        type="button"
        className="btn btn--secondary"
        onClick={removeAt}
      >
        eliminar
      </button>

      <span style={{ flex: 1 }} />

      <button
        type="button"
        className="btn btn--ghost"
        onClick={clear}
        disabled={nodes.length === 0}
        title="Limpiar"
      >
        <Trash2 size={14} /> limpiar
      </button>
    </>
  )

  return (
    <Widget
      title={title}
      subtitle="LINKED LIST"
      meta={count}
      controls={controls}
      error={error}
      dataViz="linked list"
    >
      <div
        className="flex flex-wrap items-center gap-2"
        style={{ minHeight: '4.5rem' }}
      >
        <span
          className="chrome-label"
          style={{ color: 'var(--accent-fg)', marginRight: 2 }}
        >
          head →
        </span>
        {nodes.length === 0 && (
          <span
            style={{
              color: 'var(--fg-5)',
              fontFamily: 'var(--font-mono)',
              fontStyle: 'italic',
              fontSize: 'var(--text-sm)',
            }}
          >
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
                <div
                  data-cell={node.value}
                  style={{
                    background: 'var(--bg-elev-1)',
                    border: '1.5px solid var(--border-default)',
                    color: 'var(--fg-1)',
                    fontFamily: 'var(--font-mono)',
                    borderRadius: 'var(--radius-md)',
                    padding: '6px 12px',
                    minWidth: '2.5rem',
                    textAlign: 'center',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  {node.value}
                </div>
                <span
                  style={{
                    position: 'absolute',
                    bottom: -16,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--fg-4)',
                  }}
                >
                  [{i}]
                </span>
              </div>
              <span style={{ color: 'var(--fg-4)', fontSize: 18 }}>→</span>
            </motion.div>
          ))}
          {nodes.length > 0 && (
            <motion.span
              key="null-tail"
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                color: 'var(--fg-5)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
              }}
            >
              NULL
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Widget>
  )
}
