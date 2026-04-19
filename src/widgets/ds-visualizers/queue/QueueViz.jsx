import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { VizFrame, VizBody, VizControls } from '../VizFrame.jsx'

export default function QueueViz({ initialValues = [], maxNodes = 10 }) {
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
      setError(`Queue lleno (máx ${maxNodes})`)
      return
    }
    setQueue((prev) => [...prev, { id: nextId, value: v }])
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, queue.length, nextId, maxNodes])

  const dequeue = useCallback(() => {
    if (queue.length === 0) {
      setError('Queue vacío — nada para hacer dequeue')
      return
    }
    setQueue((prev) => prev.slice(1))
    setError('')
  }, [queue.length])

  const clear = useCallback(() => {
    setQueue([])
    setError('')
  }, [])

  return (
    <VizFrame label="queue" count={queue.length} max={maxNodes} error={error}>
      <VizBody>
        <div className="flex items-center gap-3 min-h-[5rem]">
          <span className="text-xs font-mono text-fuchsia-400 shrink-0">
            front →
          </span>

          <div className="relative flex-1 flex flex-wrap items-center gap-1 pb-4">
            {queue.length === 0 && (
              <span className="text-slate-500 font-mono italic text-sm">
                vacío
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
                  <div className="rounded-md bg-slate-800 border border-slate-700 px-3 py-1.5 font-mono text-slate-100 shadow-md min-w-[2.5rem] text-center">
                    {n.value}
                  </div>
                  {i === 0 && (
                    <span className="absolute -bottom-4 text-[9px] text-fuchsia-400 font-mono whitespace-nowrap">
                      {queue.length === 1 ? 'head = tail' : 'head'}
                    </span>
                  )}
                  {i === queue.length - 1 && queue.length > 1 && (
                    <span className="absolute -bottom-4 text-[9px] text-fuchsia-400 font-mono">
                      tail
                    </span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <span className="text-xs font-mono text-fuchsia-400 shrink-0">
            ← back
          </span>
        </div>
      </VizBody>

      <VizControls>
        <input
          type="number"
          value={valueInput}
          onChange={(e) => setValueInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enqueue()
          }}
          placeholder="valor"
          className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm outline-none focus:border-fuchsia-500 transition"
        />
        <button
          onClick={enqueue}
          className="rounded bg-fuchsia-500 px-3 py-1 text-sm font-medium text-white hover:bg-fuchsia-400 transition"
        >
          enqueue
        </button>
        <button
          onClick={dequeue}
          disabled={queue.length === 0}
          className="rounded bg-slate-700 px-3 py-1 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-40 transition"
        >
          dequeue
        </button>

        <button
          onClick={clear}
          disabled={queue.length === 0}
          className="ml-auto rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition"
        >
          clear
        </button>
      </VizControls>
    </VizFrame>
  )
}
