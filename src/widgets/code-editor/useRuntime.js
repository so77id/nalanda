import { useEffect, useRef, useState, useCallback } from 'react'
import { getRuntime } from './runtimes/index.js'

export function useRuntime(languageId) {
  const workerRef = useRef(null)
  const pendingRef = useRef(new Map())
  const nextIdRef = useRef(0)
  const [warm, setWarm] = useState(false)
  const [warmStats, setWarmStats] = useState(null)

  useEffect(() => {
    const runtime = getRuntime(languageId)
    if (!runtime) return

    setWarm(false)
    setWarmStats(null)

    const worker = runtime.createWorker()
    workerRef.current = worker
    const tStart = performance.now()

    const onMessage = (e) => {
      const msg = e.data
      if (msg.type === 'warm') {
        setWarm(true)
        setWarmStats({
          totalMs: Math.round(performance.now() - tStart),
          ...(msg.stats ?? {}),
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
      pendingRef.current.forEach((p) =>
        p.reject(new Error('runtime changed'))
      )
      pendingRef.current.clear()
    }
  }, [languageId])

  const run = useCallback((source, stdin) => {
    return new Promise((resolve, reject) => {
      const worker = workerRef.current
      if (!worker) return reject(new Error('runtime not ready'))
      const id = ++nextIdRef.current
      pendingRef.current.set(id, { resolve, reject })
      worker.postMessage({ id, source, stdin })
    })
  }, [])

  return {
    run,
    warm,
    warmStats,
    runtime: getRuntime(languageId),
  }
}
