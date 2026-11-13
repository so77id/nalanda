import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useMode } from '../../presentation';
import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { AuthoringError } from '../AuthoringError';
import { floodFillProblem, floodLayers, layerHue } from './floodFillLayers';

export interface FloodFillProps {
  /** The image: its rows, all of one length, `.` a white pixel and `#` a line. */
  grid: string[];
  /**
   * `paint`, the bucket: a touch on a white pixel starts the paint there.
   * `fire`: touches pick one or more foci, and «Encender» lights them all at
   * once. Default `paint`.
   */
  mode?: 'paint' | 'fire';
  /** What the image shows, for a screen reader. In Spanish. */
  label: string;
  /** One line under the image. */
  caption?: string;
  /** Milliseconds per layer. Default 500. */
  tick?: number;
  /**
   * With `mode="fire"`: the foci a problem gives, as [row, column], placed
   * from the start; the reader may still add or remove one before lighting.
   */
  foci?: [number, number][];
  /**
   * A still frame: the given foci lit and the layers up to this one painted,
   * the newest outlined; no touch, no buttons, no status. For a step of a
   * `<StepShow>` that lights the code beside it (#357, «El incendio, turno
   * por turno»).
   */
  upTo?: number;
}

/**
 * The paint bucket of a drawing program, spreading by layers (#357 arc II):
 * the reader touches a white pixel and the paint advances one layer per tick,
 * each layer in a colour of its own and every pixel showing its layer — a
 * breadth-first search seen from outside. With `mode="fire"`, several foci
 * light together, and every pixel takes the steps from the nearest one.
 */
export function FloodFill(props: FloodFillProps) {
  const problem = floodFillProblem(props.grid);
  if (problem !== null) {
    return <AuthoringError component="FloodFill">{problem}</AuthoringError>;
  }
  return <Body {...props} />;
}

const CELL = 26;
const PAD = 4;

function Body({ grid, mode = 'paint', label, caption, tick = 500, foci, upTo }: FloodFillProps) {
  const theme = useResolvedTheme();
  const onSlide = useMode() === 'presentation';
  // MDX re-mints the literal on every render: key the memo on its text.
  const gridKey = grid.join('\n');
  const rows = useMemo(() => gridKey.split('\n'), [gridKey]);
  const R = rows.length;
  const C = rows[0].length;
  // The foci a problem gives, as pixels; the bucket starts with none.
  const fociKey = mode === 'fire' && foci ? foci.map(([r, c]) => r * C + c).join(',') : '';
  const given = useMemo(() => (fociKey === '' ? [] : fociKey.split(',').map(Number)), [fociKey]);
  const [sources, setSources] = useState<number[]>(given);
  // How many layers are painted so far; −1 before anything is lit.
  const [shown, setShown] = useState(-1);
  const [cursor, setCursor] = useState(0);
  const sourcesKey = sources.join(',');
  const layer = useMemo(
    () => floodLayers(rows, sourcesKey === '' ? [] : sourcesKey.split(',').map(Number)),
    [rows, sourcesKey],
  );
  const last = Math.max(-1, ...layer);
  const still = upTo !== undefined;
  const now = still ? upTo : shown;
  const lit = now >= 0;
  const running = !still && lit && shown < last;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setShown((n) => n + 1), tick);
    return () => window.clearTimeout(id);
  }, [running, shown, tick]);

  // A grid or foci that change start over.
  useEffect(() => {
    setSources(given);
    setShown(-1);
    setCursor(0);
  }, [gridKey, given]);

  const white = (v: number) => rows[Math.floor(v / C)][v % C] === '.';
  const unit = mode === 'fire' ? 'turno' : 'paso';

  const touch = (v: number) => {
    if (still || !white(v)) return;
    if (mode === 'paint') {
      setSources([v]);
      setShown(0);
      return;
    }
    if (lit) return;
    setSources((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  };
  const reset = () => {
    setSources(given);
    setShown(-1);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const r = Math.floor(cursor / C);
    const c = cursor % C;
    const move: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (event.key in move) {
      // The deck reads arrows from the window and yields to a handled one.
      event.preventDefault();
      const [dr, dc] = move[event.key];
      const nr = Math.min(R - 1, Math.max(0, r + dr));
      const nc = Math.min(C - 1, Math.max(0, c + dc));
      setCursor(nr * C + nc);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      touch(cursor);
    }
  };

  const painted = layer.filter((d) => d >= 0 && d <= now).length;
  const status = !lit
    ? mode === 'paint'
      ? 'Toca un píxel blanco: el balde lo pinta y la pintura se extiende.'
      : sources.length === 0
        ? 'Toca uno o más píxeles blancos para poner los focos, y después «Encender».'
        : `${sources.length === 1 ? 'Un foco' : `${sources.length} focos`}: toca otros, o «Encender».`
    : running
      ? `${mode === 'fire' ? 'El fuego' : 'La pintura'} va en el ${unit} ${shown} de ${last}.`
      : mode === 'fire'
        ? `Listo: todo se quemó en ${last} ${last === 1 ? 'turno' : 'turnos'}.`
        : `Listo: ${painted} píxeles, el último en el ${unit} ${last}.`;

  const paint = (d: number) => {
    const hue = layerHue(d, last + 1);
    return theme === 'dark'
      ? { fill: `hsl(${hue} 40% 24%)`, stroke: `hsl(${hue} 65% 62%)`, ink: 'hsl(0 0% 92%)' }
      : { fill: `hsl(${hue} 70% 88%)`, stroke: `hsl(${hue} 60% 38%)`, ink: 'hsl(0 0% 12%)' };
  };

  const width = C * CELL + 2 * PAD;
  const height = R * CELL + 2 * PAD;
  const cells = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const v = r * C + c;
      const x = PAD + c * CELL;
      const y = PAD + r * CELL;
      const d = layer[v];
      const on = d >= 0 && d <= now;
      const front = on && d === now && (running || still);
      const p = on ? paint(d) : null;
      cells.push(
        <g
          key={v}
          data-cell={`${r},${c}`}
          data-layer={on ? d : undefined}
          data-source={sources.includes(v) ? '' : undefined}
          onClick={() => touch(v)}
          style={{ cursor: !still && white(v) ? 'pointer' : 'default' }}
        >
          <rect
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            style={{
              fill: !white(v) ? 'var(--color-ink)' : p ? p.fill : 'var(--color-surface)',
              stroke: p ? p.stroke : 'var(--color-rule)',
            }}
            strokeWidth={front ? 2.6 : 1}
          />
          {on && p ? (
            <text
              x={x + CELL / 2}
              y={y + CELL / 2 + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight={front ? 700 : 400}
              style={{ fill: p.ink, pointerEvents: 'none' }}
            >
              {d}
            </text>
          ) : null}
          {sources.includes(v) ? (
            <circle
              cx={x + CELL / 2}
              cy={y + CELL / 2}
              r={CELL / 2 - 3}
              fill="none"
              style={{ stroke: 'var(--color-mark)', pointerEvents: 'none' }}
              strokeWidth="2.4"
            />
          ) : null}
        </g>,
      );
    }
  }
  const cr = Math.floor(cursor / C);
  const cc = cursor % C;

  return (
    <figure
      className="not-prose my-4 flex flex-col items-center gap-2"
      data-testid="flood-fill"
      data-mode={mode}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: '100%',
          maxWidth: `${Math.round(width * (onSlide ? 1.6 : 1.3))}px`,
          height: 'auto',
        }}
        role={still ? 'img' : 'application'}
        aria-label={
          still
            ? `${label} Quemado hasta el turno ${now}.`
            : `${label} Con las flechas se elige un píxel y con Enter se toca.`
        }
        tabIndex={still ? undefined : 0}
        onKeyDown={still ? undefined : onKeyDown}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {cells}
        {still ? null : (
          <rect
            x={PAD + cc * CELL + 1}
            y={PAD + cr * CELL + 1}
            width={CELL - 2}
            height={CELL - 2}
            fill="none"
            style={{ stroke: 'var(--color-focus)', pointerEvents: 'none' }}
            strokeWidth="2"
            strokeDasharray="4 3"
            data-cursor={`${cr},${cc}`}
          />
        )}
      </svg>
      {still ? null : (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {mode === 'fire' ? (
            <button
              type="button"
              onClick={() => sources.length > 0 && setShown(0)}
              disabled={lit || sources.length === 0}
              className="rounded border border-rule bg-surface px-3 py-1 text-sm text-ink disabled:opacity-50"
            >
              Encender
            </button>
          ) : null}
          <button
            type="button"
            onClick={reset}
            disabled={!lit && sourcesKey === given.join(',')}
            className="rounded border border-rule bg-surface px-3 py-1 text-sm text-ink disabled:opacity-50"
          >
            Reiniciar
          </button>
        </div>
      )}
      {still ? null : (
        <p className="m-0 text-center text-sm text-ink-soft" aria-live="polite">
          {status}
        </p>
      )}
      {caption ? (
        <figcaption className="text-center text-sm text-ink-soft">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
