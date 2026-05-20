import { Children, useEffect, useMemo, useState } from 'react'
import {
  Presentation as PresentationIcon,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import ThemeToggle from '../../theme/ThemeToggle.jsx'
import Appbar from '../../layout/Appbar.jsx'

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
        cover.extra = [...(cover.extra ?? []), child]
      }
    }
    if (section) out.push(section)
    return out
  }, [children, title, subtitle, summary])

  useEffect(() => {
    if (!presenting) {
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
      className="nalanda"
      style={
        presenting
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 40,
              background: 'var(--bg-page)',
              display: 'flex',
              flexDirection: 'column',
            }
          : undefined
      }
      data-mode={presenting ? 'presentation' : 'study'}
    >
      {!presenting && (
        <Appbar subtitle={subtitle}>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setPresenting(true)}
            className="btn btn--primary"
            title="Modo presentación (P)"
          >
            <PresentationIcon size={14} /> Presentar
          </button>
        </Appbar>
      )}

      {!presenting && (
        <header className="mx-auto max-w-3xl px-6 pt-12">
          <p
            style={{
              fontSize: 'var(--text-xs)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-widest)',
              color: 'var(--accent-fg)',
              fontWeight: 600,
              margin: 0,
            }}
          >
            {subtitle}
          </p>
          <h1
            style={{
              marginTop: 8,
              fontSize: 'var(--text-4xl)',
              fontWeight: 600,
              color: 'var(--fg-1)',
              letterSpacing: '-0.01em',
              lineHeight: 'var(--leading-tight)',
            }}
          >
            {title}
          </h1>
          {summary && (
            <p
              style={{
                marginTop: 12,
                color: 'var(--fg-3)',
                lineHeight: 'var(--leading-relaxed)',
              }}
            >
              {summary}
            </p>
          )}
        </header>
      )}

      <div
        className={
          presenting
            ? 'flex-1 overflow-auto flex items-center justify-center p-8'
            : 'mx-auto max-w-3xl px-6 py-12'
        }
      >
        <article
          className={
            presenting
              ? 'prose prose-lg max-w-5xl w-full'
              : 'prose max-w-none'
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
                    <div
                      className="not-prose text-center"
                      style={{ padding: '48px 0' }}
                    >
                      <p
                        style={{
                          fontSize: 'var(--text-sm)',
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-widest)',
                          color: 'var(--accent-fg)',
                          fontWeight: 600,
                          margin: 0,
                        }}
                      >
                        {slide.subtitle}
                      </p>
                      <h1
                        style={{
                          marginTop: 16,
                          fontSize: 'var(--text-6xl)',
                          fontWeight: 600,
                          color: 'var(--fg-1)',
                          lineHeight: 'var(--leading-tight)',
                        }}
                      >
                        {slide.title}
                      </h1>
                      {slide.summary && (
                        <p
                          style={{
                            marginTop: 24,
                            fontSize: 'var(--text-xl)',
                            color: 'var(--fg-3)',
                            maxWidth: '40rem',
                            marginLeft: 'auto',
                            marginRight: 'auto',
                          }}
                        >
                          {slide.summary}
                        </p>
                      )}
                    </div>
                  ) : (
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

      {presenting && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 16,
              right: 16,
              zIndex: 50,
              display: 'flex',
              gap: 8,
            }}
          >
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setPresenting(false)}
              className="btn btn--secondary"
              title="Salir (Esc)"
            >
              <X size={14} /> Cerrar
            </button>
          </div>
          <footer
            className="flex items-center justify-between"
            style={{
              background: 'var(--bg-panel)',
              borderTop: '1px solid var(--border-default)',
              padding: '12px 24px',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setCurrentSlide((s) => Math.max(s - 1, 0))}
              disabled={currentSlide === 0}
              className="btn btn--secondary"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <div
              className="flex items-center gap-3"
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--fg-3)',
              }}
            >
              <span
                data-role="slide-counter"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {currentSlide + 1} / {slides.length}
              </span>
              <div
                style={{
                  width: '10rem',
                  height: 4,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--bg-elev-1)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'var(--accent)',
                    transition: 'width var(--dur-base) ease',
                    width: `${((currentSlide + 1) / slides.length) * 100}%`,
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setCurrentSlide((s) => Math.min(s + 1, slides.length - 1))
              }
              disabled={currentSlide === slides.length - 1}
              className="btn btn--primary"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </footer>
        </>
      )}
    </div>
  )
}
