import { java } from '@codemirror/lang-java';
import type { Extension } from '@codemirror/state';

import type { RuntimeWorker } from '../contract';
import { javaDescriptor } from './descriptor';
import { createJavaRuntime } from './runtime';

export const descriptor = javaDescriptor;

export function codeMirrorLanguage(): Extension {
  return java();
}

export function createWorker(): RuntimeWorker {
  // Not a Worker: see runtime.ts — CheerpJ needs the DOM to deliver output.
  return createJavaRuntime(import.meta.env.BASE_URL);
}
