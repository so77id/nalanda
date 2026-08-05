import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, Trash2 } from 'lucide-react'
import Widget from '../Widget.jsx'

export default function QueueViz({
  initialValues = [],
  maxNodes = 10,
  title = 'Cola',
}) {
  const [queue, setQueue] = useState(() =>
    initialValues.map((v, i) => ({ id: i + 1, value: v }))
  )
  const [nextId, setNextId] = useState(initialValues.length + 1)
  const [valueInput, setValueInput] = useState('')
  const [error, setError] = useState('')

  const enqueue = useCallback(() => {
    const v = parseInt(valueInput, 10)
    if (Number.isNaN(v)) {
      setError('Ingresá un número')
      return
    }
    if (queue.length >= maxNodes) {
      setError(`Cola llena (máx ${maxNodes})`)
      return
    }
    setQueue((prev) => [...prev, { id: nextId, value: v }])
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, queue.length, nextId, maxNodes])

  const dequeue = useCallback(() => {
    if (queue.length === 0) {
      setError('Cola vacía')
      return
    }
    setQueue((prev) => prev.slice(1))
    setError('')
  }, [queue.length])

  const clear = useCallback(() => {
    setQueue([])
    setError('')
  }, [])

  const count = (
    <span className="chip chip--muted">
      {queue.length} / {maxNodes}
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
          if (e.key === 'Enter') enqueue()
        }}
        placeholder="valor"
      />
      <button
        type="button"
        className="btn btn--primary"
        onClick={enqueue}
      >
        <ArrowRight size={14} /> enqueue
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={dequeue}
        disabled={queue.length === 0}
      >
        <ArrowLeft size={14} /> dequeue
      </button>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="btn btn--ghost"
        onClick={clear}
        disabled={queue.length === 0}
      >
        <Trash2 size={14} /> limpiar
      </button>
    </>
  )

  return (
    <Widget
      title={title}
      subtitle="QUEUE · FIFO"
      meta={count}
      controls={controls}
      error={error}
      dataViz="queue"
    >
      <div
        className="flex items-center gap-3"
        style={{ minHeight: '5rem' }}
      >
        <span
          className="chrome-label"
          style={{ color: 'var(--accent-fg)', flexShrink: 0 }}
        >
          front →
        </span>

        <div
          className="relative flex-1 flex flex-wrap items-center gap-1"
          style={{ paddingBottom: 16 }}
        >
          {queue.length === 0 && (
            <span
              style={{
                color: 'var(--fg-5)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                fontStyle: 'italic',
              }}
            >
              vacía
            </span>
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            {queue.map((n, i) => (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.6 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -40, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="relative flex flex-col items-center"
              >
                <div
                  data-cell={n.value}
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
                  {n.value}
                </div>
                {i === 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -16,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: 'var(--accent-fg)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {queue.length === 1 ? 'head = tail' : 'head'}
                  </span>
                )}
                {i === queue.length - 1 && queue.length > 1 && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -16,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: 'var(--accent-fg)',
                    }}
                  >
                    tail
                  </span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <span
          className="chrome-label"
          style={{ color: 'var(--accent-fg)', flexShrink: 0 }}
        >
          ← back
        </span>
      </div>
    </Widget>
  )
}
