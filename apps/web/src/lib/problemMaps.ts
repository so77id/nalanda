import { parse } from 'yaml';

/** One problem of a unit's map: the question, where it is solved, and with what. */
export interface MapProblem {
  question: string;
  /** The document where it is solved; absent, it stays open in the course. */
  solvedIn?: string;
  tool: string;
}

/** A unit's problem map: its documents in order, and its problems. */
export interface ProblemMapData {
  docs: string[];
  problems: MapProblem[];
}

/**
 * Every `<name>.problems.yaml` under a course, by name: the single source a
 * unit's documents show with `<ProblemMap>` (#356). `lib/` and not `content/`
 * because `components/` reads it and may not import a sibling feature — the
 * shape `contentAssets.ts` set.
 */
const raw = import.meta.glob('@content/courses/*/*.problems.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const maps = new Map(
  Object.entries(raw).map(([path, text]) => [
    path.replace(/^.*\//, '').replace(/\.problems\.yaml$/, ''),
    parse(text) as ProblemMapData,
  ]),
);

/** The map named `name`, or `null` when no `<name>.problems.yaml` exists. */
export function problemMap(name: string): ProblemMapData | null {
  return maps.get(name) ?? null;
}
