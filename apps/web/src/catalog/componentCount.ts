/**
 * How many components a family holds, as a phrase rather than a number with a
 * parenthesised plural. Zero says "no components": on the overview that cell is
 * read as a state ("is anything here?"), not as an arithmetic result.
 */
export function componentCount(n: number): string {
  if (n === 0) return 'no components';
  return `${n} component${n === 1 ? '' : 's'}`;
}
