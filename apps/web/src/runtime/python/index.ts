import type { RuntimeWorker } from '../contract';
import { pythonDescriptor } from './descriptor';

export const descriptor = pythonDescriptor;

export function createWorker(): RuntimeWorker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}
