import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SourceFile } from './SourceFile';

vi.mock('../../lib/contentCode', () => ({
  resolveCode: (src: string) => (src === 'asset:x.code/Graph.java' ? 'a\nb\nc\nd\n' : null),
}));

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => (
    <textarea readOnly value={value} data-testid="code-listing" />
  ),
}));

describe('SourceFile', () => {
  it('quotes the range of the file it names, under the file’s name', () => {
    render(<SourceFile src="asset:x.code/Graph.java" range="2-3" />);

    expect(screen.getByTestId('stepshow-listing').dataset['listing']).toBe('Graph.java');
    expect(screen.getByTestId('listing-range').textContent).toBe('líneas 2–3 de 4');
    expect((screen.getByTestId('code-listing') as HTMLTextAreaElement).value).toBe('b\nc');
  });

  it('opens the whole file with the quoted lines banded', () => {
    render(<SourceFile src="asset:x.code/Graph.java" range="2-3" />);

    fireEvent.click(screen.getByRole('button', { name: /ver archivo/i }));
    const file = within(screen.getByRole('dialog')).getByTestId('viewer-file');
    expect(file.querySelector('[data-band-lines]')?.getAttribute('data-band-lines')).toBe('2,3');
  });

  it('says so on the page when the file is not under content/', () => {
    render(<SourceFile src="asset:x.code/Nope.java" />);

    expect(document.querySelector('[data-authoring-error]')?.textContent).toMatch(/Nope\.java/);
  });
});
