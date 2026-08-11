/**
 * The browsercc build the worker downloads at runtime.
 *
 * The package is a devDependency for its types only. Its toolchain is 113MB of
 * WASM (clang 42MB, sysroot 29MB, lld 23MB, a 19MB precompiled header), and
 * browsercc addresses those files with `new URL(…, import.meta.url)` — so a
 * bundled import makes them build outputs, published on every deploy. Importing
 * the module *from the CDN* points `import.meta.url` at jsDelivr instead, and
 * the toolchain never touches our origin. Same arrangement as Pyodide.
 */
export const BROWSERCC_VERSION = '0.1.1';

export const BROWSERCC_CDN = `https://cdn.jsdelivr.net/npm/browsercc@${BROWSERCC_VERSION}/dist/index.js`;
