// CheerpJ ships as a classic script from the vendor's CDN, not as a typed
// package, so its globals are declared here — the one place that knows the
// shape we depend on (ADR-0016).
declare global {
  function cheerpjInit(options?: {
    version?: 8 | 11 | 17;
    status?: 'none' | 'default' | 'splash';
    javaProperties?: string[];
  }): Promise<void>;

  function cheerpjCreateDisplay(width: number, height: number, parent?: HTMLElement): void;

  function cheerpjAddStringFile(path: string, data: Uint8Array): void;

  /** Resolves with the program's exit code. */
  function cheerpjRunMain(className: string, classPath: string, ...args: string[]): Promise<number>;
}

export {};
