import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { VizFrame, VizBody, VizControls } from '../VizFrame.jsx'

export default function StackViz({ initialValues = [], maxNodes = 10 }) {
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
      setError(`Stack lleno (máx ${maxNodes})`)
      return
    }
    setStack((prev) => [...prev, { id: nextId, value: v }])
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, stack.length, nextId, maxNodes])

  const pop = useCallback(() => {
    if (stack.length === 0) {
      setError('Stack vacío — nada para hacer pop')
      return
    }
    setStack((prev) => prev.slice(0, -1))
    setError('')
  }, [stack.length])

  const clear = useCallback(() => {
    setStack([])
    setError('')
  }, [])

  return (
    <VizFrame label="stack" count={stack.length} max={maxNodes} error={error}>
      <VizBody>
        <div className="flex gap-4 items-stretch">
          <div className="flex flex-col justify-between text-xs font-mono text-slate-500 py-1">
            <span className="text-fuchsia-400">top ↓</span>
            <span>bottom</span>
          </div>

          <div className="relative flex flex-col-reverse items-center gap-1 min-w-[5rem] min-h-[12rem]">
            <div className="absolute bottom-0 left-0 right-0 border-b-2 border-slate-700" />
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
                  <div className="rounded-md bg-slate-800 border border-slate-700 px-4 py-1.5 font-mono text-slate-100 shadow-md min-w-[3rem] text-center">
                    {n.value}
                  </div>
                  {i === stack.length - 1 && (
                    <span className="text-[10px] text-fuchsia-400 font-mono">
                      ← top
                    </span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {stack.length === 0 && (
              <span className="text-slate-500 font-mono text-sm italic self-center mt-auto mb-3">
                vacío
              </span>
            )}
          </div>
        </div>
      </VizBody>

      <VizControls>
        <input
          type="number"
          value={valueInput}
          onChange={(e) => setValueInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') push()
          }}
          placeholder="valor"
          className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm outline-none focus:border-fuchsia-500 transition"
        />
        <button
          onClick={push}
          className="rounded bg-fuchsia-500 px-3 py-1 text-sm font-medium text-white hover:bg-fuchsia-400 transition"
        >
          push
        </button>
        <button
          onClick={pop}
          disabled={stack.length === 0}
          className="rounded bg-slate-700 px-3 py-1 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-40 transition"
        >
          pop
        </button>

        <button
          onClick={clear}
          disabled={stack.length === 0}
          className="ml-auto rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition"
        >
          clear
        </button>
      </VizControls>
    </VizFrame>
  )
}
