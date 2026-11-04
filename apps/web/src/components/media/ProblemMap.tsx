import { problemMap, type MapProblem } from '../../lib/problemMaps';
import { AuthoringError } from '../AuthoringError';

export interface ProblemMapProps {
  /** Which map: `grafos` reads `grafos.problems.yaml`. */
  map: string;
  /** The document showing it: each problem's state is relative to it. */
  at: string;
}

/** Where a problem stands from the document showing the map. */
export type ProblemState = 'here' | 'solved' | 'later' | 'open';

export function stateOf(docs: string[], at: string, p: MapProblem): ProblemState {
  if (p.solvedIn === undefined) return 'open';
  const d = docs.indexOf(p.solvedIn);
  const here = docs.indexOf(at);
  return d === here ? 'here' : d < here ? 'solved' : 'later';
}

const CHIP: Record<ProblemState, { text: string; cls: string }> = {
  here: { text: 'aquí', cls: 'bg-mark-soft text-mark' },
  solved: { text: 'resuelto', cls: 'bg-keep-soft text-keep' },
  later: { text: 'pendiente', cls: 'bg-sunk text-ink-soft' },
  open: { text: 'abierto', cls: 'bg-accent-soft text-accent' },
};

/**
 * A unit's map of problems: every question the unit poses, whether the
 * document showing it solves it, an earlier one did, a later one will, or it
 * stays open — and with what, once solved. One data source per unit, so every
 * document shows the same map, complete, and none names another by number.
 */
export function ProblemMap({ map, at }: ProblemMapProps) {
  const data = problemMap(map);
  if (data === null) {
    return (
      <AuthoringError component="ProblemMap">
        no encuentra el mapa «{map}»: falta el archivo {map}.problems.yaml.
      </AuthoringError>
    );
  }
  if (!data.docs.includes(at)) {
    return (
      <AuthoringError component="ProblemMap">
        no sabe dónde está «{at}»: no es un documento del mapa «{map}».
      </AuthoringError>
    );
  }
  return (
    <table className="not-prose my-4 w-full border-collapse text-sm" data-problem-map={map}>
      <thead>
        <tr className="border-b border-rule-strong text-left text-ink-soft">
          <th className="py-1.5 pr-3 font-semibold">Problema</th>
          <th className="py-1.5 pr-3 font-semibold">Estado</th>
          <th className="py-1.5 font-semibold">Con qué</th>
        </tr>
      </thead>
      <tbody>
        {data.problems.map((p) => {
          const state = stateOf(data.docs, at, p);
          const chip = CHIP[state];
          return (
            <tr key={p.question} data-state={state} className="border-b border-rule">
              <td className="py-1 pr-3 text-ink">{p.question}</td>
              <td className="py-1 pr-3">
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${chip.cls}`}>
                  {chip.text}
                </span>
              </td>
              <td className="py-1 text-ink-soft">{state === 'later' ? '—' : p.tool}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
