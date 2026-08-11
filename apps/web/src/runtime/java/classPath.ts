/** The compiler jar, fetched into `public/` at build time (see scripts/fetch-java-compiler.mjs). */
export const COMPILER_JAR = 'java-compiler.jar';

/** Where compiled classes are written and read from, inside CheerpJ's virtual FS. */
export const OUTPUT_DIR = '/files/';

/**
 * The classpath handed to ECJ and to the launcher.
 *
 * CheerpJ mounts the web server root at `/app/`, so the deployed base path is
 * part of the jar's address: under `/nalanda/` the jar lives at
 * `/app/nalanda/java-compiler.jar`. Derived from `BASE_URL` rather than
 * hardcoded, because the jsdom suite always sees `/` (testing-strategy.md).
 */
export function javaClassPath(baseUrl: string): string {
  const base = baseUrl.replace(/^\/+|\/+$/g, '');
  const jarPath = base ? `/app/${base}/${COMPILER_JAR}` : `/app/${COMPILER_JAR}`;
  return `${jarPath}:${OUTPUT_DIR}`;
}
