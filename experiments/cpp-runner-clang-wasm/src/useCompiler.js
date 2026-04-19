import { useEffect, useRef, useState, useCallback } from 'react'

export function useCompiler() {
  const workerRef = useRef(null)
  const pendingRef = useRef(new Map())
  const nextIdRef = useRef(0)
  const [warm, setWarm] = useState(false)
  const [warmStats, setWarmStats] = useState(null)

  useEffect(() => {
    const worker = new Worker(
      new URL('./compiler.worker.js', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker
    const tStart = performance.now()

    const onMessage = (e) => {
      const msg = e.data
      if (msg.type === 'warm') {
        setWarm(true)
        setWarmStats({
          totalMs: Math.round(performance.now() - tStart),
          pchFetchMs: msg.pchFetchMs,
          warmCompileMs: msg.warmCompileMs,
        })
        return
      }
      if (msg.id != null) {
        const pending = pendingRef.current.get(msg.id)
        if (!pending) return
        pendingRef.current.delete(msg.id)
        if (msg.type === 'error') pending.reject(new Error(msg.message))
        else pending.resolve(msg)
      }
    }
    worker.addEventListener('message', onMessage)
    return () => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const run = useCallback((source, stdin) => {
    return new Promise((resolve, reject) => {
      const worker = workerRef.current
      if (!worker) return reject(new Error('worker not initialized'))
      const id = ++nextIdRef.current
      pendingRef.current.set(id, { resolve, reject })
      worker.postMessage({ id, source, stdin })
    })
  }, [])

  return { run, warm, warmStats }
}
