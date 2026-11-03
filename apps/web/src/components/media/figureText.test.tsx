import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { captionWidth, codeText } from './figureText';

const drawn = (text: string | undefined) =>
  render(
    <svg>
      <text>{codeText(text)}</text>
    </svg>,
  ).container.querySelector('text') as SVGTextElement;

describe('codeText', () => {
  it('draws a backticked part in the code face and the rest as it is', () => {
    const text = drawn('el `get` de la tabla');
    expect(text.textContent).toBe('el get de la tabla');
    const code = text.querySelectorAll('tspan');
    expect(code).toHaveLength(1);
    expect(code[0].textContent).toBe('get');
    expect(code[0].getAttribute('font-family')).toContain('mono');
  });

  it('draws nothing for no text', () => {
    expect(drawn(undefined).textContent).toBe('');
  });
});

describe('captionWidth', () => {
  it('asks nothing for no caption', () => {
    expect(captionWidth(undefined)).toBe(0);
    expect(captionWidth('')).toBe(0);
  });

  it('measures what a caption shows, not its backticks', () => {
    expect(captionWidth('`get` de la tabla')).toBe(captionWidth('get de la tabla'));
    expect(captionWidth('x'.repeat(20))).toBeLessThan(captionWidth('x'.repeat(40)));
  });
});
