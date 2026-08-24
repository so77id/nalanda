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
      <h3 className="text-accent-pop text-lg font-semibold">{title}</h3>
      <div className="mt-2 rounded border border-rule p-4">{children}</div>
      <pre className="mt-2 overflow-x-auto rounded bg-surface p-3 text-sm text-ink-soft">
        <code>{code}</code>
      </pre>
    </section>
  );
}
