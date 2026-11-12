import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodeFileViewer } from './CodeFileViewer';
import { Step, StepShow } from './StepShow';

// The same two stand-ins StepShow.test.tsx uses for the files a document keeps
// beside it (ADR-0091), and the same CodeMirror stub: the editor is not the
// contract here, and it does not render in jsdom.
vi.mock('../../lib/contentCode', () => ({
  resolveCode: (src: string) =>
    ({
      'asset:x.code/Graph.java': 'a\nb\nc\nd\ne\nf\n',
      'asset:x.code/Main.java': 'm1\nm2\n',
    })[src] ?? null,
}));

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => (
    <textarea readOnly value={value} data-testid="code-listing" />
  ),
}));

vi.mock('../useViewportBreakout', () => ({ useViewportBreakout: vi.fn() }));

const FILES = [
  { name: 'Main.java', source: 'm1\nm2\n', first: 1, last: 2, lines: [1] },
  { name: 'Graph.java', source: 'a\nb\nc\n', first: 2, last: 3, lines: [3] },
];

/** A walk over two files, opened on its code file. */
function openWalk() {
  render(
    <StepShow programSrc="asset:x.code/Main.java" codeSrc="asset:x.code/Graph.java" codeRange="3-4">
      <Step lines={[3]} programLines={[1]}>
        <span>a</span>
      </Step>
      <Step lines={[4]} programLines={[2]}>
        <span>b</span>
      </Step>
      <Step lines={[4]} programLines={[2]}>
        <span>c</span>
      </Step>
    </StepShow>,
  );
  const opener = screen.getAllByRole('button', { name: /ver archivo/i })[1]!;
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole('dialog') };
}

describe('CodeFileViewer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('walks one step per arrow, and the deck underneath never hears it', () => {
    const deck = vi.fn();
    window.addEventListener('keydown', deck);
    try {
      const { dialog } = openWalk();
      expect(within(dialog).getByText('paso 1 de 3')).toBeTruthy();
      fireEvent.keyDown(dialog, { key: 'ArrowRight' });
      expect(within(dialog).getByText('paso 2 de 3')).toBeTruthy();
      fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
      expect(within(dialog).getByText('paso 1 de 3')).toBeTruthy();
      expect(deck).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', deck);
    }
  });

  it('keeps focus where the reader left it while the walk steps', () => {
    // Re-subscribing the keys on each step used to send focus to the opener
    // and back to the dialog on every arrow (#363's review). Focus order and
    // movement are a browser property (apps/web/CLAUDE.md class 2); jsdom does
    // keep `activeElement`, which is what this pins.
    const { dialog } = openWalk();
    const tab = within(dialog).getAllByRole('tab')[0]!;
    tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(within(dialog).getByText('paso 2 de 3')).toBeTruthy();
    expect(document.activeElement).toBe(tab);
  });

  it('gives focus back to «Ver archivo» on close', () => {
    const { opener, dialog } = openWalk();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a click outside the file, not on one inside it', () => {
    const onClose = vi.fn();
    render(<CodeFileViewer files={FILES} start={0} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches file with its tabs', () => {
    render(<CodeFileViewer files={FILES} start={0} onClose={() => {}} />);
    const file = () => screen.getByTestId('viewer-file').dataset['file'];
    expect(file()).toBe('Main.java');
    fireEvent.click(screen.getByRole('tab', { name: /Graph\.java/ }));
    expect(file()).toBe('Graph.java');
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
  });
});
