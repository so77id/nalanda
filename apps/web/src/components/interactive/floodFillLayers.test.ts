import { describe, expect, it } from 'vitest';

import { floodFillProblem, floodLayers, layerHue } from './floodFillLayers';

describe('floodLayers', () => {
  it('numbers each white pixel by its steps from the source, and leaves lines at −1', () => {
    // A 3 × 4 image: a line down the third column, open at the bottom.
    const grid = ['..#.', '..#.', '....'];
    expect(floodLayers(grid, [0])).toEqual([0, 1, -1, 7, 1, 2, -1, 6, 2, 3, 4, 5]);
  });

  it('moves only up, down, left and right: a diagonal of lines closes a region', () => {
    const grid = ['.#..', '#...', '....'];
    // The corner pixel touches the rest only through a corner.
    expect(floodLayers(grid, [0])).toEqual([0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
  });

  it('gives every pixel its steps from the NEAREST of several sources', () => {
    const grid = ['.....'];
    expect(floodLayers(grid, [0, 4])).toEqual([0, 1, 2, 1, 0]);
  });

  it('paints nothing from a source on a line, and ignores one off the image', () => {
    const grid = ['.#.'];
    expect(floodLayers(grid, [1])).toEqual([-1, -1, -1]);
    expect(floodLayers(grid, [7])).toEqual([-1, -1, -1]);
  });
});

describe('floodFillProblem', () => {
  it('accepts rows of one length made of «.» and «#»', () => {
    expect(floodFillProblem(['.#', '..'])).toBeNull();
  });

  it('tells the author when rows differ, are empty, or carry another character', () => {
    expect(floodFillProblem(['..', '.'])).toMatch(/mismo largo/);
    expect(floodFillProblem([])).toMatch(/mismo largo/);
    expect(floodFillProblem(['.x'])).toMatch(/la fila 0 trae «.x»/);
  });
});

describe('layerHue', () => {
  it('spreads the layers from red to violet, none repeated', () => {
    const hues = Array.from({ length: 12 }, (_, k) => layerHue(k, 12));
    expect(hues[0]).toBe(0);
    expect(hues[11]).toBe(300);
    expect(new Set(hues).size).toBe(12);
  });

  it('paints a single layer red', () => {
    expect(layerHue(0, 1)).toBe(0);
  });
});
