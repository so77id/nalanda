import { Children, useEffect, useMemo, useState } from 'react'

export default function Presentation({ subtitle, title, summary, children }) {
  const [presenting, setPresenting] = useState(false)
  const [currentSlide, setCurrentSlide] = useState(0)

  const slides = useMemo(() => {
    const arr = Children.toArray(children)
    const cover = { kind: 'cover', title, subtitle, summary }
    const out = [cover]
    let section = null
    for (const child of arr) {
      if (child.type === 'h2') {
        if (section) out.push(section)
        section = { kind: 'section', titleNode: child, content: [] }
      } else if (section) {
        section.content.push(child)
      } else {
        // pre-h2 content — attach to the cover section so it still renders
        cover.extra = [...(cover.extra ?? []), child]
      }
    }
    if (section) out.push(section)
    return out
  }, [children, title, subtitle, summary])

  useEffect(() => {
    if (!presenting) {
      // If someone presses "p" from study mode, enter presentation
      const onKeyStudy = (e) => {
        if (e.key === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const t = e.target
          const editable =
            t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable
          if (editable) return
          setPresenting(true)
        }
      }
      window.addEventListener('keydown', onKeyStudy)
      return () => window.removeEventListener('keydown', onKeyStudy)
    }
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') setPresenting(false)
      else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        setCurrentSlide((s) => Math.min(s + 1, slides.length - 1))
      } else if (e.key === 'ArrowLeft') {
        setCurrentSlide((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Home') {
        setCurrentSlide(0)
      } else if (e.key === 'End') {
        setCurrentSlide(slides.length - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [presenting, slides.length])

  return (
    <div
      className={
        presenting ? 'fixed inset-0 z-40 bg-slate-950 flex flex-col' : ''
      }
      data-mode={presenting ? 'presentation' : 'study'}
    >
      {!presenting && (
        <header className="mx-auto max-w-3xl px-6 pt-12 text-slate-200">
          <p className="text-xs uppercase tracking-widest text-fuchsia-400">
            {subtitle}
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-slate-100">
            {title}
          </h1>
          {summary && <p className="mt-3 text-slate-400">{summary}</p>}
        </header>
      )}

      <div
        className={
          presenting
            ? 'flex-1 overflow-auto flex items-center justify-center p-8'
            : 'mx-auto max-w-3xl px-6 py-12 text-slate-200'
        }
      >
        <article
          className={
            presenting
              ? 'prose prose-invert prose-slate prose-lg max-w-5xl w-full prose-h2:text-slate-100 prose-a:text-fuchsia-400'
              : 'prose prose-invert prose-slate max-w-none prose-h2:text-slate-100 prose-a:text-fuchsia-400'
          }
        >
          {slides.map((slide, i) => {
            const hidden = presenting && i !== currentSlide
            return (
              <section
                key={i}
                style={hidden ? { display: 'none' } : undefined}
                data-slide={i}
              >
                {slide.kind === 'cover' ? (
                  presenting ? (
                    <div className="text-center py-12 not-prose">
                      <p className="text-sm uppercase tracking-widest text-fuchsia-400">
                        {slide.subtitle}
                      </p>
                      <h1 className="mt-4 text-5xl md:text-6xl font-semibold text-slate-100">
                        {slide.title}
                      </h1>
                      {slide.summary && (
                        <p className="mt-6 text-slate-400 text-xl max-w-2xl mx-auto">
                          {slide.summary}
                        </p>
                      )}
                    </div>
                  ) : (
                    // study mode: the <header> above already shows
                    // subtitle/title/summary; only render extra pre-h2 content
                    slide.extra
                  )
                ) : (
                  <>
                    {slide.titleNode}
                    {slide.content}
                  </>
                )}
              </section>
            )
          })}
        </article>
      </div>

      {!presenting && (
        <button
          onClick={() => setPresenting(true)}
          className="fixed top-4 right-4 z-30 rounded-md bg-fuchsia-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-fuchsia-400 transition shadow-lg"
          title="Modo presentación (P)"
        >
          📽️ Presentar
        </button>
      )}

      {presenting && (
        <>
          <button
            onClick={() => setPresenting(false)}
            className="fixed top-4 right-4 z-50 rounded-md border border-slate-700 bg-slate-900/80 backdrop-blur px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 transition"
            title="Salir (Esc)"
          >
            ✕ Cerrar
          </button>
          <footer className="bg-slate-900 border-t border-slate-800 px-6 py-3 flex items-center justify-between shrink-0">
            <button
              onClick={() =>
                setCurrentSlide((s) => Math.max(s - 1, 0))
              }
              disabled={currentSlide === 0}
              className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition"
            >
              ← Anterior
            </button>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span className="font-mono">
                {currentSlide + 1} / {slides.length}
              </span>
              <div className="w-40 h-1 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-fuchsia-500 transition-all duration-300"
                  style={{
                    width: `${((currentSlide + 1) / slides.length) * 100}%`,
                  }}
                />
              </div>
            </div>
            <button
              onClick={() =>
                setCurrentSlide((s) => Math.min(s + 1, slides.length - 1))
              }
              disabled={currentSlide === slides.length - 1}
              className="rounded-md bg-fuchsia-500 px-3 py-1 text-sm font-medium text-white hover:bg-fuchsia-400 disabled:opacity-40 transition"
            >
              Siguiente →
            </button>
          </footer>
        </>
      )}
    </div>
  )
}
