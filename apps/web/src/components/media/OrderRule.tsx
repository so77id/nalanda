import { AuthoringError } from '../AuthoringError';

export interface OrderRuleProps {
  /** The parts of the rule, in order: `['izquierda', 'raíz', 'derecha']`. At least two. */
  parts: string[];
  /** The colour of the traversal it states, the one its drawings use. */
  tone?: 'focus' | 'accent' | 'mark' | 'keep';
  /** What the rule says, in Spanish: its accessible name. Required. */
  label: string;
}

/**
 * The rule of a traversal written short: its parts as pills joined by arrows,
 * in the traversal's colour — `nodo → hijos` for the preorder, `izquierda →
 * raíz → derecha` for the inorder. It states the rule before the drawing that
 * walks it.
 *
 * Promoted from a figure local to Árboles I when Árboles II became the second
 * document to want it (#322, `add-a-course-document.md` §6e-quater).
 */
export function OrderRule({ parts, tone = 'focus', label }: OrderRuleProps) {
  if (label === undefined || label === '') {
    return (
      <AuthoringError component="OrderRule">
        necesita un label que diga la regla, en español.
      </AuthoringError>
    );
  }
  if (!Array.isArray(parts) || parts.length < 2) {
    return (
      <AuthoringError component="OrderRule">
        necesita al menos dos partes que poner en orden, como{' '}
        <code>{"parts={['nodo', 'hijos']}"}</code>.
      </AuthoringError>
    );
  }
  const color = `var(--color-${tone})`;
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '0.6rem',
        margin: '1rem 0',
        fontWeight: 700,
        fontSize: '1.15em',
      }}
    >
      {parts.flatMap((part, i) => [
        i > 0 ? (
          <span key={`a${i}`} aria-hidden="true" style={{ color }}>
            →
          </span>
        ) : null,
        <span
          key={`p${i}`}
          data-part
          aria-hidden="true"
          style={{
            border: `2px solid ${color}`,
            borderRadius: '999px',
            padding: '0.1rem 0.9rem',
            color: 'var(--color-ink)',
          }}
        >
          {part}
        </span>,
      ])}
    </div>
  );
}
