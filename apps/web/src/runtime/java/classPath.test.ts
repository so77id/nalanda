import { describe, expect, it } from 'vitest';

import { COMPILER_JAR, javaClassPath } from './classPath';

describe('javaClassPath', () => {
  // CheerpJ mounts the web server root at /app/, so the deployment base path is
  // part of the jar's address. Getting this wrong only shows up in production,
  // where the site is served under /nalanda/ (ADR-0015).
  it('addresses the jar through the deployment base path', () => {
    expect(javaClassPath('/nalanda/')).toBe(`/app/nalanda/${COMPILER_JAR}:/files/`);
  });

  it('works at the domain root, as in dev', () => {
    expect(javaClassPath('/')).toBe(`/app/${COMPILER_JAR}:/files/`);
  });

  it('tolerates a base path without a trailing slash', () => {
    expect(javaClassPath('/nalanda')).toBe(`/app/nalanda/${COMPILER_JAR}:/files/`);
  });

  it('always includes the output directory, so compiled classes are found', () => {
    expect(javaClassPath('/')).toContain(':/files/');
  });
});
