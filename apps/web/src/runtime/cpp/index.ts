import type { RuntimeWorker } from '../contract';
import { cppDescriptor } from './descriptor';

export const descriptor = cppDescriptor;

export function createWorker(): RuntimeWorker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}
