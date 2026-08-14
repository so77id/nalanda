import type { ReactNode } from 'react';

export interface AuthoringErrorProps {
  /** The component whose contract was broken, e.g. `Exercise`. */
  component: string;
  /** What is wrong and how to fix it, addressed to whoever wrote the document. */
  children: ReactNode;
}

/**
 * A content component telling its **author** that the document is wrong.
 *
 * Two rules make this different from an ordinary error state. It never blames
 * the reader — a missing fence is the author's typo, and saying "your program
 * reported no cases" hands a student a defect they cannot fix. And it renders
 * rather than throwing, so one broken block does not take the page with it.
 *
 * The stricter sibling is `content/contentIntegrity.ts`, which fails the build:
 * use that when the mistake is detectable without rendering (frontmatter, ids,
 * the index). This is for contracts only visible once MDX has been evaluated.
 */
export function AuthoringError({ component, children }: AuthoringErrorProps) {
  return (
    <div className="not-prose my-6 rounded-lg border border-flag bg-flag-soft px-3 py-2 font-mono text-xs text-flag">
      &lt;{component}&gt; {children}
    </div>
  );
}
