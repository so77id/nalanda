import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FloodFill } from './FloodFill';

// A 3 × 4 image: a line down the third column, open at the bottom.
const GRID = ['..#.', '..#.', '....'];

const cell = (rc: string) => document.querySelector(`[data-cell="${rc}"]`) as Element;
const layerOf = (rc: string) => cell(rc).getAttribute('data-layer');
// Each layer is scheduled once React has painted the one before: one tick per act.
const ticks = (n: number, ms = 100) => {
  for (let i = 0; i < n; i++) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }
};

describe('FloodFill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('paints the touched pixel, then one layer per tick, each pixel showing its layer', () => {
    render(<FloodFill grid={GRID} label="Una imagen." tick={100} />);
    expect(screen.getByText(/Toca un píxel blanco/)).toBeInTheDocument();
    fireEvent.click(cell('0,0'));
    expect(layerOf('0,0')).toBe('0');
    expect(layerOf('0,1')).toBeNull();
    ticks(1);
    expect(layerOf('0,1')).toBe('1');
    expect(layerOf('1,0')).toBe('1');
    ticks(10);
    // The far corner, round the line: seven steps.
    expect(layerOf('0,3')).toBe('7');
    expect(screen.getByText('Listo: 10 píxeles, el último en el paso 7.')).toBeInTheDocument();
  });

  it('does not paint a line, and Reiniciar clears the paint', () => {
    render(<FloodFill grid={GRID} label="Una imagen." tick={100} />);
    fireEvent.click(cell('0,2'));
    expect(document.querySelector('[data-layer]')).toBeNull();
    fireEvent.click(cell('2,3'));
    expect(layerOf('2,3')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }));
    expect(document.querySelector('[data-layer]')).toBeNull();
  });

  it('in fire mode, picks several foci and lights them together', () => {
    render(<FloodFill grid={['.....']} mode="fire" label="Un bosque." tick={100} />);
    const light = screen.getByRole('button', { name: 'Encender' });
    expect(light).toBeDisabled();
    fireEvent.click(cell('0,0'));
    fireEvent.click(cell('0,4'));
    expect(document.querySelectorAll('[data-source]')).toHaveLength(2);
    expect(document.querySelector('[data-layer]')).toBeNull();
    fireEvent.click(light);
    ticks(5);
    expect(['0,0', '0,1', '0,2', '0,3', '0,4'].map(layerOf)).toEqual(['0', '1', '2', '1', '0']);
    expect(screen.getByText('Listo: todo se quemó en 2 turnos.')).toBeInTheDocument();
  });

  it('starts from the foci a problem gives, and Reiniciar puts them back', () => {
    render(
      <FloodFill grid={['.....']} mode="fire" foci={[[0, 2]]} label="Un terreno." tick={100} />,
    );
    expect(document.querySelectorAll('[data-source]')).toHaveLength(1);
    expect(cell('0,2')).toHaveAttribute('data-source');
    fireEvent.click(screen.getByRole('button', { name: 'Encender' }));
    ticks(3);
    expect(['0,0', '0,1', '0,2', '0,3', '0,4'].map(layerOf)).toEqual(['2', '1', '0', '1', '2']);
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }));
    expect(document.querySelector('[data-layer]')).toBeNull();
    expect(cell('0,2')).toHaveAttribute('data-source');
  });

  it('moves a cursor with the arrows and touches with Enter, keeping the arrows from the deck', () => {
    render(<FloodFill grid={GRID} label="Una imagen." tick={100} />);
    const image = screen.getByRole('application', { name: /Una imagen\. Con las flechas/ });
    const right = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      image.dispatchEvent(right);
    });
    expect(right.defaultPrevented).toBe(true);
    fireEvent.keyDown(image, { key: 'ArrowDown' });
    expect(document.querySelector('[data-cursor]')).toHaveAttribute('data-cursor', '1,1');
    fireEvent.keyDown(image, { key: 'Enter' });
    expect(layerOf('1,1')).toBe('0');
  });

  it('draws a still frame with upTo: the foci lit, the layers up to it, no buttons', () => {
    render(<FloodFill grid={['.....']} mode="fire" foci={[[0, 2]]} upTo={1} label="Un terreno." />);
    expect(['0,0', '0,1', '0,2', '0,3', '0,4'].map(layerOf)).toEqual([null, '1', '0', '1', null]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByRole('img', { name: 'Un terreno. Quemado hasta el turno 1.' }),
    ).toBeInTheDocument();
    fireEvent.click(cell('0,0'));
    expect(layerOf('0,0')).toBeNull();
  });

  it('tells the author when the image is malformed', () => {
    render(<FloodFill grid={['..', '.x']} label="Una imagen." />);
    expect(screen.getByText(/la fila 1 trae «.x»/)).toBeInTheDocument();
  });
});
