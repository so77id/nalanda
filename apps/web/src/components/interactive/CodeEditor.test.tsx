import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { draftKey, readDraft, saveDraft } from './draft';
import { EmbeddedProvider } from '../embedded';
import { ModeProvider } from '../../presentation';
import type { RunRequest, RuntimeWorker, WorkerMessage } from '../../runtime';
import { runtimeDescriptors } from '../../runtime';
import { CodeEditor } from './CodeEditor';

// CodeMirror's editing surface is not the contract under test here, and its
// contenteditable does not behave in jsdom. The panels, the run flow and the
// per-mode shape are what the component promises.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, basicSetup }: { value: string; basicSetup?: { lineNumbers?: boolean } }) => (
    <textarea
      readOnly
      value={value}
      data-testid="code"
      data-line-numbers={String(basicSetup?.lineNumbers)}
    />
  ),
}));

const workers: FakeWorker[] = [];

class FakeWorker implements RuntimeWorker {
  readonly posted: RunRequest[] = [];
  private readonly listeners = new Set<(event: MessageEvent<WorkerMessage>) => void>();

  postMessage(message: RunRequest): void {
    this.posted.push(message);
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(
    _type: 'message',
    listener: (event: MessageEvent<WorkerMessage>) => void,
  ): void {
    this.listeners.delete(listener);
  }
  terminate(): void {}

  reply(message: WorkerMessage): void {
    for (const listener of this.listeners) {
      listener({ data: message } as MessageEvent<WorkerMessage>);
    }
  }
}

vi.mock('../../runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../runtime')>();
  return {
    ...original,
    loadRuntime: vi.fn(async () => ({
      descriptor: {
        id: 'cpp' as const,
        label: 'C++20',
        fileName: 'main.cpp',
        defaultCode: 'int main(){}\n',
      },
      codeMirrorLanguage: () => [],
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    })),
  };
});

function renderEditor(
  props: Partial<React.ComponentProps<typeof CodeEditor>> = {},
  mode?: 'book' | 'presentation',
) {
  return render(
    <ModeProvider mode={mode ?? 'book'}>
      <CodeEditor language="cpp" {...props} />
    </ModeProvider>,
  );
}

/** This environment has no usable localStorage of its own; drafts need one. */
function fakeStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => void entries.set(k, v),
    removeItem: (k: string) => void entries.delete(k),
    clear: () => entries.clear(),
    key: (i: number) => [...entries.keys()][i] ?? null,
    get length() {
      return entries.size;
    },
  };
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CodeEditor', () => {
  it('seeds the editor with the runtime sample when given no source', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue('int main(){}\n'));
    expect(screen.getByText('main.cpp')).toBeInTheDocument();
  });

  it('prefers an explicit snippet over the sample', async () => {
    renderEditor({ defaultValue: 'int x = 1;' });
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue('int x = 1;'));
  });

  it('starts no runtime for a read-only snippet', async () => {
    renderEditor({ runnable: false, editable: false });
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());

    // AC6: a document full of snippets must not download compilers.
    expect(screen.queryByRole('button', { name: /ejecutar/i })).not.toBeInTheDocument();
    expect(workers).toHaveLength(0);
  });

  it('runs the source and shows the program output', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /ejecutar/i }));
    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    await waitFor(() => expect(worker.posted).toHaveLength(1));

    worker.reply({
      id: worker.posted[0]!.id,
      type: 'result',
      compileLog: '',
      output: 'sum = 15',
      exitCode: 0,
      compileMs: 12,
      runMs: 3,
    });

    expect(await screen.findByText('sum = 15')).toBeInTheDocument();
    expect(screen.getByText(/exit 0/)).toBeInTheDocument();
    expect(screen.getByText(/compila 12ms/)).toBeInTheDocument();
  });

  it('shows a failed compile as diagnostics, not as a crash', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /ejecutar/i }));
    await waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
    const worker = workers[0]!;

    worker.reply({
      id: worker.posted[0]!.id,
      type: 'result',
      compileLog: "error: expected ';'",
      output: '',
      exitCode: null,
      compileMs: 8,
      runMs: null,
    });

    expect(await screen.findByText(/expected ';'/)).toBeInTheDocument();
    expect(screen.getByText(/errores de compilación/i)).toBeInTheDocument();
    expect(screen.queryByText(/exit /)).not.toBeInTheDocument();
  });

  it('sends the stdin panel content to the program', async () => {
    const user = userEvent.setup();
    renderEditor({ showStdin: true, defaultStdin: '7\n' });
    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /ejecutar/i }));
    await waitFor(() => expect(workers[0]?.posted).toHaveLength(1));

    expect(workers[0]!.posted[0]).toMatchObject({ stdin: '7\n' });
  });

  it('surfaces a broken runtime instead of failing silently', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /ejecutar/i }));
    await waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
    const worker = workers[0]!;

    worker.reply({ id: worker.posted[0]!.id, type: 'error', message: 'compiler unreachable' });

    expect(await screen.findByText(/compiler unreachable/)).toBeInTheDocument();
  });

  it('keeps a read variant inert', async () => {
    renderEditor({ variant: 'read' });
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /ejecutar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Lenguaje')).not.toBeInTheDocument();
    expect(workers).toHaveLength(0);
  });

  it('boots the runtime up front when the variant asks for it', async () => {
    // Java costs ~12s to boot on a warm CDN, ~29s on a cold one (ADR-0017);
    // a lab should spend that before the student presses anything.
    renderEditor({ variant: 'lab' });
    await waitFor(() => expect(workers).toHaveLength(1));
    expect(workers[0]!.posted).toHaveLength(0);
  });

  it('says the run is waiting for another editor rather than standing silent', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /ejecutar/i }));
    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    await waitFor(() => expect(worker.posted).toHaveLength(1));

    // Warm, so "preparando el runtime" would be a lie: nothing is downloading.
    // The run is queued behind another editor on the page (PER-2).
    worker.reply({ type: 'warm', detail: {} });
    expect(await screen.findByText(/esperando/i)).toBeInTheDocument();

    worker.reply({ id: worker.posted[0]!.id, type: 'started' });
    await waitFor(() => expect(screen.queryByText(/esperando/i)).not.toBeInTheDocument());
  });

  it('copies the source to the clipboard', async () => {
    const user = userEvent.setup();
    renderEditor({ variant: 'snippet', defaultValue: 'int x = 1;' });
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue('int x = 1;'));

    await user.click(screen.getByRole('button', { name: /copiar/i }));

    expect(await screen.findByText('Copiado')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('int x = 1;');
  });

  it('expands to fullscreen and closes on Escape', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /expandir/i }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
  });

  it('offers every registered runtime in the picker and reseeds on change', async () => {
    const user = userEvent.setup();
    renderEditor({ variant: 'lab', defaultValue: 'int x = 1;' });
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue('int x = 1;'));

    const picker = screen.getByLabelText('Lenguaje');
    expect(picker).toHaveValue('cpp');
    expect(within(picker).getAllByRole('option').length).toBe(runtimeDescriptors.length);

    await user.selectOptions(picker, 'python');

    // The snippet belonged to the language it was written for; the new one gets
    // its own sample rather than C++ under a Python compiler.
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue('int main(){}\n'));
  });

  it('clears the previous run when the language changes', async () => {
    const user = userEvent.setup();
    renderEditor({ variant: 'lab', warmOnMount: false });
    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /ejecutar/i }));
    await waitFor(() => expect(workers[0]?.posted).toHaveLength(1));
    const worker = workers[0]!;
    worker.reply({
      id: worker.posted[0]!.id,
      type: 'result',
      compileLog: 'warning: cpp diagnostic',
      output: 'CPP OUTPUT',
      exitCode: 3,
      compileMs: 12,
      runMs: 4,
    });
    expect(await screen.findByText('CPP OUTPUT')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Lenguaje'), 'python');

    // Results belong to the language that produced them.
    await waitFor(() => expect(screen.queryByText('CPP OUTPUT')).not.toBeInTheDocument());
    expect(screen.queryByText(/exit 3/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cpp diagnostic/)).not.toBeInTheDocument();
  });

  it('says nothing when a run is abandoned mid-flight', async () => {
    const user = userEvent.setup();
    renderEditor({ variant: 'lab', warmOnMount: false });
    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /ejecutar/i }));
    await waitFor(() => expect(workers[0]?.posted).toHaveLength(1));

    // Switch language without ever replying: the pending run is abandoned.
    await user.selectOptions(screen.getByLabelText('Lenguaje'), 'python');

    await waitFor(() => expect(screen.getByRole('button', { name: /ejecutar/i })).toBeEnabled());
    expect(screen.queryByText(/abandoned|runtime changed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnósticos/i)).not.toBeInTheDocument();
  });

  it('hides the fullscreen affordance in presentation mode', async () => {
    renderEditor({}, 'presentation');
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());

    // A slide is already fullscreen (ADR-0010: no component may ignore a mode).
    expect(screen.queryByRole('button', { name: /expandir/i })).not.toBeInTheDocument();
  });

  it('gives the slide more room in presentation mode than in book mode', async () => {
    const { container: book } = renderEditor({}, 'book');
    await waitFor(() => expect(screen.getAllByTestId('code').length).toBeGreaterThan(0));
    const { container: slide } = renderEditor({}, 'presentation');

    // ADR-0010: no component may ignore a mode.
    expect(book.querySelector('.max-h-64')).not.toBeNull();
    expect(slide.querySelector('[class*="55vh"]')).not.toBeNull();
  });

  it('lets a listing take its full height in the book, with no scrollbar of its own', async () => {
    // A listing that scrolls inside itself while the reader scrolls the page is
    // the most irritating thing a long document can do — and unlike an editor,
    // a snippet has no reason to: the page already scrolls.
    const { container } = renderEditor({ variant: 'snippet' }, 'book');
    await waitFor(() => expect(screen.getAllByTestId('code').length).toBeGreaterThan(0));

    expect(container.querySelector('.max-h-64')).toBeNull();
    expect(container.querySelector('.overflow-auto')).toBeNull();
  });

  it('keeps the slide’s internal scroll for a listing, where the screen does not grow', async () => {
    // On a slide the box scrolling is not a defect: it is the only way through
    // code that does not fit without shrinking the type past legibility.
    const { container } = renderEditor({ variant: 'snippet' }, 'presentation');
    await waitFor(() => expect(screen.getAllByTestId('code').length).toBeGreaterThan(0));

    expect(container.querySelector('[class*="55vh"]')).not.toBeNull();
  });

  it('drops its own frame and filename when a container already provides them', async () => {
    // Inside a SideBySide column the editor used to stack a second header and a
    // second rounded border inside the column's own — the frame the bare <pre>
    // never had, because `[&_pre]:border-0` flattened it.
    const { container } = render(
      <ModeProvider mode="book">
        <EmbeddedProvider value={true}>
          <CodeEditor language="cpp" variant="snippet" defaultValue="int main() {}" />
        </EmbeddedProvider>
      </ModeProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('code').length).toBeGreaterThan(0));

    const shell = container.querySelector('.not-prose');
    expect(shell?.className).not.toContain('border');
    expect(shell?.className).not.toContain('rounded');
    expect(shell?.className).not.toContain('my-6');
    expect(screen.queryByText('main.cpp')).not.toBeInTheDocument();
    // The column's label already says which language this is; repeating it
    // under the label is the second half of the doubled header.
    expect(screen.queryByText('C++20')).not.toBeInTheDocument();
    // The gutter goes too, and this is the half that is not cosmetic: it costs
    // ~22px of a ~376px column, which is exactly the margin the #76 fix lives
    // on. Measured in a browser at 1440px — 21px of clipping, the closing `);`
    // of the longest Java line gone — not reasoned about.
    expect(screen.getByTestId('code').dataset['lineNumbers']).toBe('false');
  });

  it('keeps the copy button when embedded — the reason a listing is quotable', async () => {
    render(
      <ModeProvider mode="book">
        <EmbeddedProvider value={true}>
          <CodeEditor language="cpp" variant="snippet" defaultValue="int main() {}" />
        </EmbeddedProvider>
      </ModeProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('code').length).toBeGreaterThan(0));

    expect(screen.getByRole('button', { name: /copiar/i })).toBeInTheDocument();
  });

  it('keeps its own frame when nothing contains it', async () => {
    const { container } = renderEditor({ variant: 'snippet' }, 'book');
    await waitFor(() => expect(screen.getAllByTestId('code').length).toBeGreaterThan(0));

    expect(container.querySelector('.not-prose')?.className).toContain('border');
    expect(screen.getByText('main.cpp')).toBeInTheDocument();
    expect(screen.getByTestId('code').dataset['lineNumbers']).toBe('true');
  });

  it('still caps an editable editor in the book, which is not a listing', async () => {
    // The cap is what stops a long exercise pushing its own Run button off the
    // screen; only the read-only case gives it up.
    const { container } = renderEditor({ variant: 'exercise' }, 'book');
    await waitFor(() => expect(screen.getAllByTestId('code').length).toBeGreaterThan(0));

    expect(container.querySelector('.max-h-64')).not.toBeNull();
  });
});

// A Java loop that never ends freezes the tab for good (ADR-0017/ADR-0020), and
// this document ships eight runnable Java editors. Both halves of the mitigation
// could be deleted with the whole suite green before these existed.
describe('CodeEditor drafts', () => {
  // Mirrors the component: page, language, and this editor's own starting
  // source — the last part is what keeps two editors on one page apart.
  const scope = (lang: string) => `${globalThis.location?.pathname ?? ''}#${lang}#`;
  const key = () => draftKey(scope('cpp'), 'int main(){}\n');

  it('restores what the reader had instead of the seed', async () => {
    saveDraft(key(), 'int main(){ /* mi intento */ }');
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('code')).toHaveValue('int main(){ /* mi intento */ }'),
    );
  });

  it('saves the buffer before the run, not after it', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue('int main(){}\n'));
    expect(readDraft(key())).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /ejecutar/i }));
    // Posted and never answered: that IS the frozen tab. See Exercise's twin.
    await waitFor(() => expect(workers).toHaveLength(1));
    await waitFor(() => expect(workers[0]!.posted).toHaveLength(1));
    expect(readDraft(key())).toBe('int main(){}\n');
  });

  it('keeps a draft per language, as the buffers are', () => {
    saveDraft(key(), 'int main(){ /* cpp */ }');
    expect(readDraft(draftKey(scope('java'), 'int main(){}\n'))).toBeNull();
  });
});
