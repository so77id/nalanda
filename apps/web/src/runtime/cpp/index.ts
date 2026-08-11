import { cpp } from '@codemirror/lang-cpp';
import type { Extension } from '@codemirror/state';

import type { RuntimeWorker } from '../contract';
import { cppDescriptor } from './descriptor';

export const descriptor = cppDescriptor;

export function codeMirrorLanguage(): Extension {
  return cpp();
}

export function createWorker(): RuntimeWorker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}
