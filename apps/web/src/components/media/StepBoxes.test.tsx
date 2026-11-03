import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { StepBoxes } from './StepBoxes';

const LABEL = 'La clave «Ana», su número y su posición, unidos por los dos pasos.';
const BOXES = [
  { title: 'clave', text: '«Ana»' },
  { title: 'número', text: '4 288 097' },
  { title: 'posición', text: '2' },
];

describe('StepBoxes', () => {
  it('is one image, named by its label', () => {
    render(<StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label={LABEL} />);
    expect(screen.getByRole('img', { name: LABEL })).toBeTruthy();
  });

  it('writes each box with its title, and each step over its arrow', () => {
    const { container } = render(
      <StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label={LABEL} />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(3);
    expect(container.querySelectorAll('line')).toHaveLength(2);
    expect(container.textContent).toBe('clave«Ana»número4 288 097posición2base 256mod 7');
  });

  it('writes a backticked part of a title in the code face', () => {
    const { container } = render(
      <StepBoxes
        boxes={[
          { title: 'el objeto `a`', text: '13.180.992-1' },
          { title: 'su posición', text: '5' },
        ]}
        steps={['hashCode()']}
        label="El objeto a y su posición."
      />,
    );
    const code = container.querySelector('tspan');
    expect(code?.textContent).toBe('a');
    expect(code?.getAttribute('font-family')).toContain('mono');
  });

  it('draws every box as wide as boxWidth, on a canvas that holds them', () => {
    const { container } = render(
      <StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} boxWidth={150} label={LABEL} />,
    );
    const widths = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('width'));
    expect(widths).toEqual(['150', '150', '150']);
    // pad 14 on each side, three boxes of 150, two steps of 150; titles, boxes and a margin
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(
      `0 0 ${2 * 14 + 3 * 150 + 2 * 150} ${26 + 44 + 12}`,
    );
  });

  it('writes its caption under the boxes, a backticked part in the code face', () => {
    const height = (container: HTMLElement) =>
      Number(container.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[3]);
    const plain = render(<StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label={LABEL} />);
    const { container } = render(
      <StepBoxes
        boxes={BOXES}
        steps={['base 256', 'mod 7']}
        caption="la posición de `Ana`"
        label={LABEL}
      />,
    );
    expect(height(container)).toBeGreaterThan(height(plain.container));
    const caption = [...container.querySelectorAll('svg > text')].at(-1);
    expect(caption?.textContent).toBe('la posición de Ana');
    expect(caption?.querySelector('tspan')?.textContent).toBe('Ana');
  });

  it('gives every figure its own arrowhead, so two on one page never share an id', () => {
    const { container } = render(
      <>
        <StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label={LABEL} />
        <StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label={LABEL} />
      </>,
    );
    const ids = [...container.querySelectorAll('marker')].map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const line = container.querySelector('line');
    expect(line?.getAttribute('marker-end')).toBe(`url(#${ids[0]})`);
  });

  it('draws the same in the book and on a slide', () => {
    const book = render(
      <ModeProvider mode="book">
        <StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label={LABEL} />
      </ModeProvider>,
    )
      .container.querySelector('svg')
      ?.getAttribute('viewBox');
    const slide = render(
      <ModeProvider mode="presentation">
        <StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label={LABEL} />
      </ModeProvider>,
    )
      .container.querySelector('svg')
      ?.getAttribute('viewBox');
    expect(slide).toBe(book);
  });

  it('tells the author when the label is missing', () => {
    const { container } = render(
      <StepBoxes boxes={BOXES} steps={['base 256', 'mod 7']} label="" />,
    );
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when there is one box only', () => {
    const { container } = render(<StepBoxes boxes={BOXES.slice(0, 1)} steps={[]} label={LABEL} />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when the steps do not fit between the boxes', () => {
    const { container } = render(<StepBoxes boxes={BOXES} steps={['mod 7']} label={LABEL} />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});
