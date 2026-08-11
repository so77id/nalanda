import type { ReactNode } from 'react';

interface Props {
  title: string;
  code: string;
  children: ReactNode;
}

/** A live example: the real component running, with its source beside it (plain <pre>, ADR-0014). */
export function ExampleBlock({ title, code, children }: Props) {
  return (
    <section className="mt-6">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="mt-2 rounded border border-slate-800 p-4">{children}</div>
      <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-sm text-slate-300">
        <code>{code}</code>
      </pre>
    </section>
  );
}
