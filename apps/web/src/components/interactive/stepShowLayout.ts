// Pure layout arithmetic for `<StepShow>`, kept out of the component file so
// the suite can check it exactly and fast refresh keeps working.

/**
 * The beside grid's columns for a "code/drawing" ratio, or undefined for the
 * default split (and for a ratio that is not two positive numbers, which then
 * falls back to it rather than collapsing a column).
 */
export function besideColumns(ratio: string | undefined): string | undefined {
  if (ratio === undefined) return undefined;
  const parts = ratio.split('/').map((x) => Number(x.trim()));
  if (parts.length !== 2 || parts.some((x) => !(x > 0))) return undefined;
  return `minmax(0,${parts[0]}fr) minmax(0,${parts[1]}fr)`;
}
