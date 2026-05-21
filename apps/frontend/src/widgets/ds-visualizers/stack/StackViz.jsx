import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus, Trash2 } from 'lucide-react'
import Widget from '../Widget.jsx'

export default function StackViz({
  initialValues = [],
  maxNodes = 10,
  title = 'Pila',
}) {
  const [stack, setStack] = useState(() =>
    initialValues.map((v, i) => ({ id: i + 1, value: v }))
  )
  const [nextId, setNextId] = useState(initialValues.length + 1)
  const [valueInput, setValueInput] = useState('')
  const [error, setError] = useState('')

  const push = useCallback(() => {
    const v = parseInt(valueInput, 10)
    if (Number.isNaN(v)) {
      setError('Ingresá un número')
      return
    }
    if (stack.length >= maxNodes) {
      setError(`Pila llena (máx ${maxNodes})`)
      return
    }
    setStack((prev) => [...prev, { id: nextId, value: v }])
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, stack.length, nextId, maxNodes])

  const pop = useCallback(() => {
    if (stack.length === 0) {
      setError('Pila vacía')
      return
    }
    setStack((prev) => prev.slice(0, -1))
    setError('')
  }, [stack.length])

  const clear = useCallback(() => {
    setStack([])
    setError('')
  }, [])

  const count = (
    <span className="chip chip--muted">
      {stack.length} / {maxNodes}
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
          if (e.key === 'Enter') push()
        }}
        placeholder="valor"
      />
      <button
        type="button"
        className="btn btn--primary"
        onClick={push}
      >
        <Plus size={14} /> push
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={pop}
        disabled={stack.length === 0}
      >
        <Minus size={14} /> pop
      </button>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="btn btn--ghost"
        onClick={clear}
        disabled={stack.length === 0}
      >
        <Trash2 size={14} /> limpiar
      </button>
    </>
  )

  return (
    <Widget
      title={title}
      subtitle="STACK · LIFO"
      meta={count}
      controls={controls}
      error={error}
      dataViz="stack"
    >
      <div className="flex gap-4 items-stretch">
        <div
          className="flex flex-col justify-between"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-4)',
            padding: '4px 0',
          }}
        >
          <span style={{ color: 'var(--accent-fg)' }}>top ↓</span>
          <span>bottom</span>
        </div>

        <div
          className="relative flex flex-col-reverse items-center gap-1"
          style={{ minWidth: '5rem', minHeight: '12rem' }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              borderBottom: '2px solid var(--border-default)',
            }}
          />
          <AnimatePresence mode="popLayout" initial={false}>
            {stack.map((n, i) => (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, y: -30, scale: 0.6 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -30, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                className="flex items-center gap-2"
              >
                <div
                  data-cell={n.value}
                  style={{
                    background: 'var(--bg-elev-1)',
                    border: '1.5px solid var(--border-default)',
                    color: 'var(--fg-1)',
                    fontFamily: 'var(--font-mono)',
                    borderRadius: 'var(--radius-md)',
                    padding: '6px 16px',
                    minWidth: '3rem',
                    textAlign: 'center',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  {n.value}
                </div>
                {i === stack.length - 1 && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--accent-fg)',
                    }}
                  >
                    ← top
                  </span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {stack.length === 0 && (
            <span
              style={{
                color: 'var(--fg-5)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                fontStyle: 'italic',
                alignSelf: 'center',
                marginTop: 'auto',
                marginBottom: 12,
              }}
            >
              vacía
            </span>
          )}
        </div>
      </div>
    </Widget>
  )
}
