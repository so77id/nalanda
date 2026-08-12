import type { Extension } from '@codemirror/state';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { useMemo } from 'react';

/**
 * Ctrl/Cmd + Enter runs what the student wrote, from inside the editor.
 *
 * It has to be a CodeMirror extension rather than a React handler: CodeMirror
 * owns key events on its own DOM node, so a bubbled listener only sees Enter
 * after a newline has already been inserted. `Prec.highest` puts it ahead of
 * the default keymap, which binds Mod-Enter to inserting a blank line.
 */
export function useRunShortcut(run: () => void): Extension {
  return useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              run();
              return true;
            },
          },
        ]),
      ),
    [run],
  );
}
