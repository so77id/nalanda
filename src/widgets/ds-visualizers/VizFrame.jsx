export function VizFrame({ label, count, max, error, children }) {
  return (
    <div
      data-viz={label}
      className="not-prose my-6 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 overflow-hidden"
    >
      <div className="flex items-center gap-3 bg-slate-800/60 px-3 py-1.5 text-xs">
        <span className="font-mono uppercase tracking-wide text-slate-400">
          {label}
        </span>
        {count != null && max != null && (
          <span className="text-[10px] text-slate-500 font-mono">
            {count} / {max}
          </span>
        )}
      </div>
      {children}
      {error && (
        <p className="bg-amber-500/10 border-t border-amber-500/20 text-amber-300 text-xs px-4 py-1.5">
          ⚠ {error}
        </p>
      )}
    </div>
  )
}

export function VizBody({ children, className = '' }) {
  return (
    <div className={`bg-slate-900 px-4 py-4 ${className}`}>{children}</div>
  )
}

export function VizControls({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-slate-950 border-t border-slate-800 px-4 py-3">
      {children}
    </div>
  )
}
