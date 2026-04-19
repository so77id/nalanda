import * as cppRuntime from './cpp.js'
import * as pythonRuntime from './python.js'

export const runtimes = {
  cpp: cppRuntime,
  python: pythonRuntime,
}

export const runtimeList = Object.values(runtimes)

export function getRuntime(id) {
  return runtimes[id] ?? null
}
