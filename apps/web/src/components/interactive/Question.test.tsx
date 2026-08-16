import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { KnownSectionsProvider } from '../../lib/knownSections';
import { Question } from './Question';

/**
 * The element shape MDX produces for a GFM task list, measured through the real
 * plugin list — the same shape `lib/questions.test.tsx` documents. Built by hand
 * so these cases need nothing in `content/`, which is published (ADR-0025).
 */
function alternatives(...items: [string, boolean][]) {
  return (
    <ul className="contains-task-list">
      {items.map(([text, correct]) => (
        <li className="task-list-item" key={text}>
          <input type="checkbox" disabled checked={correct} readOnly /> {text}
        </li>
      ))}
    </ul>
  );
}

function simple() {
  return (
    <Question id="una-respuesta">
      <p>¿Cuál es el índice del primer elemento?</p>
      {alternatives(['0', true], ['1', false], ['-1', false], ['Depende', false])}
    </Question>
  );
}

function multiple() {
  return (
    <Question id="varias-respuestas">
      <p>¿Cuáles de estas declaraciones compilan?</p>
      {alternatives(
        ['int x = 1;', true],
        ['var y = 2;', false],
        ['long z = 3;', true],
        ['int[] w;', false],
      )}
    </Question>
  );
}

describe('an anchor that names no section', () => {
  function anchored(anchor: string) {
    return (
      <Question id="anclada" anchor={anchor}>
        <p>¿Cuál es el índice del primer elemento?</p>
        {alternatives(['0', true], ['1', false], ['-1', false], ['Depende', false])}
      </Question>
    );
  }

  it('paints an authoring error instead of the question', () => {
    render(
      <KnownSectionsProvider value={new Set(['seccion-real'])}>
        {anchored('seccion-que-no-existe')}
      </KnownSectionsProvider>,
    );

    expect(document.querySelector('[data-authoring-error="Question"]')).toBeInTheDocument();
    expect(screen.getByText(/seccion-que-no-existe/)).toBeInTheDocument();
  });

  it('renders normally when the anchor resolves', () => {
    render(
      <KnownSectionsProvider value={new Set(['seccion-real'])}>
        {anchored('seccion-real')}
      </KnownSectionsProvider>,
    );

    expect(document.querySelector('[data-authoring-error]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
  });

  it('says nothing while the spine has not been measured', () => {
    // The sections are read from the DOM after mount, so the set is empty on
    // the first render of every document. Treating empty as authority would
    // flash an error over every correct question on every page load.
    render(anchored('seccion-que-no-existe'));

    expect(document.querySelector('[data-authoring-error]')).not.toBeInTheDocument();
  });
});

describe('Question', () => {
  describe('the type is visible before answering', () => {
    it('badges a question that admits several answers', () => {
      render(multiple());
      expect(screen.getByText(/varias respuestas/i)).toBeInTheDocument();
    });

    it('leaves a single-answer question unbadged', () => {
      // Deliberately asymmetric with the printed sheet, which labels both. A
      // chapter renders ten or fifteen questions at once, and repeating "una
      // respuesta" on every one of them is what stops the exception standing
      // out — which is the only thing the badge is for.
      render(simple());
      expect(screen.queryByText(/una respuesta/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/varias respuestas/i)).not.toBeInTheDocument();
    });
  });

  describe('a single-answer question', () => {
    it('reveals the verdict on the first click', async () => {
      const user = userEvent.setup();
      render(simple());

      await user.click(screen.getByRole('button', { name: '0' }));

      expect(screen.getByRole('status')).toHaveTextContent(/correcto/i);
    });
  });

  describe('a question with several answers', () => {
    it('does not reveal anything until the reader commits the set', async () => {
      const user = userEvent.setup();
      render(multiple());

      await user.click(screen.getByRole('button', { name: 'int x = 1;' }));

      // Half a set is not an answer. Revealing here would grade a reader who
      // had not finished answering, and on a question whose whole point is
      // that the set is the unit.
      expect(screen.getByRole('status')).toHaveTextContent('');
      expect(screen.getByRole('button', { name: 'int x = 1;' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('is right only when the committed set is exactly the correct one', async () => {
      const user = userEvent.setup();
      render(multiple());

      await user.click(screen.getByRole('button', { name: 'int x = 1;' }));
      await user.click(screen.getByRole('button', { name: 'long z = 3;' }));
      await user.click(screen.getByRole('button', { name: /comprobar/i }));

      expect(screen.getByRole('status')).toHaveTextContent(/correcto/i);
    });

    it('is wrong when a correct alternative is missing, even with none wrong', async () => {
      const user = userEvent.setup();
      render(multiple());

      await user.click(screen.getByRole('button', { name: 'int x = 1;' }));
      await user.click(screen.getByRole('button', { name: /comprobar/i }));

      expect(screen.getByRole('status')).toHaveTextContent(/incorrecto/i);
    });

    it('shows a picked alternative as picked, before anything is committed', async () => {
      const user = userEvent.setup();
      render(multiple());

      const picked = screen.getByRole('button', { name: 'int x = 1;' });
      const untouched = screen.getByRole('button', { name: 'int[] w;' });
      await user.click(picked);

      // `aria-pressed` alone is not enough: a sighted reader ticking three boxes
      // would watch the page not change at all. Compared against a sibling
      // rather than against a literal class list, so restyling the state does
      // not have to come back through this test.
      expect(picked.className).not.toBe(untouched.className);
    });

    it('lets the reader unmark before committing', async () => {
      const user = userEvent.setup();
      render(multiple());

      const first = screen.getByRole('button', { name: 'int x = 1;' });
      await user.click(first);
      await user.click(first);

      expect(first).toHaveAttribute('aria-pressed', 'false');
    });

    it('cannot be committed empty', () => {
      render(multiple());

      // Blank scores zero on the sheet, but on the page an empty commit is a
      // misclick rather than an answer, and revealing on it costs the reader
      // the question for nothing.
      expect(screen.getByRole('button', { name: /comprobar/i })).toBeDisabled();
    });
  });
});
