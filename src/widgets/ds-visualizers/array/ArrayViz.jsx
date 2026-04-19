import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2 } from 'lucide-react'
import Widget from '../Widget.jsx'

/**
 * ArrayViz — index-addressable array.
 *
 * Props:
 *   initialValues   number[]   starting items
 *   capacity        number     total slots; empty ones render as placeholders
 *   highlight       number     index to highlight (controlled)
 *   showIndices     bool       default true
 *   label           string     optional row label, e.g. "arr"
 *   title           string     widget header title
 *   readOnly        bool       hide controls (no push / access)
 */
export default function ArrayViz({
  initialValues = [],
  capacity = 10,
  highlight = null,
  showIndices = true,
  label,
  title = 'Arreglo',
  readOnly = false,
}) {
  const [items, setItems] = useState(() =>
    initialValues.map((v, i) => ({ id: i + 1, value: v }))
  )
  const [nextId, setNextId] = useState(initialValues.length + 1)
  const [valueInput, setValueInput] = useState('')
  const [accessInput, setAccessInput] = useState('')
  const [accessed, setAccessed] = useState(highlight)
  const [error, setError] = useState('')

  const push = useCallback(() => {
    const v = parseInt(valueInput, 10)
    if (Number.isNaN(v)) {
      setError('Ingresá un número')
      return
    }
    if (items.length >= capacity) {
      setError(`Arreglo lleno (${capacity})`)
      return
    }
    setItems((prev) => [...prev, { id: nextId, value: v }])
    setNextId((id) => id + 1)
    setValueInput('')
    setError('')
  }, [valueInput, items.length, nextId, capacity])

  const access = useCallback(() => {
    const i = parseInt(accessInput, 10)
    if (Number.isNaN(i) || i < 0 || i >= items.length) {
      setError(`Índice fuera de rango (0..${items.length - 1})`)
      setAccessed(null)
      return
    }
    setAccessed(i)
    setError('')
  }, [accessInput, items.length])

  const clear = useCallback(() => {
    setItems([])
    setAccessed(null)
    setError('')
  }, [])

  const effectiveHighlight = highlight ?? accessed
  const slots = Array.from({ length: capacity }, (_, i) => items[i])

  const countChip = (
    <span className="chip chip--muted">
      {items.length} / {capacity}
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
        value={accessInput}
        onChange={(e) => setAccessInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') access()
        }}
        placeholder="idx"
      />
      <button
        type="button"
        className="btn btn--secondary"
        onClick={access}
      >
        arr[i]
      </button>

      <span style={{ flex: 1 }} />

      <button
        type="button"
        className="btn btn--ghost"
        onClick={clear}
        disabled={items.length === 0}
      >
        <Trash2 size={14} /> limpiar
      </button>
    </>
  )

  return (
    <Widget
      title={title}
      subtitle="ARRAY"
      meta={countChip}
      controls={controls}
      error={error}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {label && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-3)',
              paddingBottom: 10,
            }}
          >
            {label}
          </div>
        )}
        <div style={{ display: 'flex', gap: 2 }}>
          <AnimatePresence initial={false}>
            {slots.map((slot, i) => {
              const isHi = i === effectiveHighlight
              const empty = !slot
              return (
                <motion.div
                  key={slot ? slot.id : `empty-${i}`}
                  layout
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.4 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-lg)',
                      background: empty
                        ? 'var(--bg-panel)'
                        : 'var(--bg-elev-1)',
                      color: empty ? 'var(--fg-5)' : 'var(--fg-1)',
                      border: `1.5px solid ${
                        isHi ? 'var(--accent)' : 'var(--border-default)'
                      }`,
                      boxShadow: isHi ? '0 0 0 3px var(--accent-glow)' : 'none',
                      borderRight:
                        i === slots.length - 1 ? undefined : 'none',
                      transition:
                        'border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease',
                    }}
                  >
                    {empty ? '·' : String(slot.value)}
                  </div>
                  {showIndices && (
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: isHi ? 'var(--accent-fg)' : 'var(--fg-4)',
                      }}
                    >
                      {i}
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </Widget>
  )
}
