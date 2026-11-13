/**
 * The layers of a flood fill, as `<FloodFill>` paints them: a breadth-first
 * search over an image's white pixels from one or more sources, each pixel
 * at the number of steps from the nearest source. Pure, so the suite pins
 * every pixel's layer exactly; the colours are the browser's to check.
 */

/** What is wrong with an image `<FloodFill>` is given, or null. In Spanish. */
export function floodFillProblem(grid: readonly string[]): string | null {
  const lengths = grid.map((row) => row.length);
  if (grid.length === 0 || lengths[0] === 0 || lengths.some((n) => n !== lengths[0])) {
    return `las filas de grid tienen que tener todas el mismo largo, y no ser vacías (llegaron de ${lengths.join(', ') || 'ninguna'}).`;
  }
  const odd = grid.findIndex((row) => /[^.#]/.test(row));
  if (odd >= 0) {
    return `grid solo lleva «.» (un píxel blanco) y «#» (una línea); la fila ${odd} trae «${grid[odd]}».`;
  }
  return null;
}

/**
 * Each pixel's layer, row by row (pixel r · C + c): the fewest steps from the
 * nearest source to it, moving up, down, left or right through white pixels
 * only; −1 for a line or a pixel no source reaches. A source on a line paints
 * nothing.
 */
export function floodLayers(grid: readonly string[], sources: readonly number[]): number[] {
  const R = grid.length;
  const C = R > 0 ? grid[0].length : 0;
  const layer = Array.from({ length: R * C }, () => -1);
  const white = (r: number, c: number) => r >= 0 && r < R && c >= 0 && c < C && grid[r][c] === '.';
  const queue: number[] = [];
  for (const s of sources) {
    const r = Math.floor(s / C);
    const c = s % C;
    if (s >= 0 && s < R * C && white(r, c) && layer[s] === -1) {
      layer[s] = 0;
      queue.push(s);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    const r = Math.floor(v / C);
    const c = v % C;
    for (const [dr, dc] of STEPS) {
      const w = (r + dr) * C + (c + dc);
      if (white(r + dr, c + dc) && layer[w] === -1) {
        layer[w] = layer[v] + 1;
        queue.push(w);
      }
    }
  }
  return layer;
}

/** Up, down, left, right: the order of the class's DR4 and DC4. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * The hue of a layer, among `count` layers: spread from red (0) to violet
 * (300) so no two layers of one fill share a colour, however many there are.
 */
export function layerHue(layer: number, count: number): number {
  return count <= 1 ? 0 : Math.round((layer * 300) / (count - 1));
}
