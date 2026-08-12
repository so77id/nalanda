import { describe, expect, it } from 'vitest';

import { HARNESS_CLASS, buildHarness, readRun } from './harness';

describe('buildHarness', () => {
  it('names the class the runtime will use as the entry point', () => {
    expect(buildHarness('')).toContain(`class ${HARNESS_CLASS}`);
  });

  it("puts the author's cases inside main", () => {
    const harness = buildHarness('check(Solution.doble(2), 4);');
    const main = harness.slice(harness.indexOf('void main'));
    expect(main).toContain('check(Solution.doble(2), 4);');
  });

  it('offers check for the shapes an exercise actually returns', () => {
    const harness = buildHarness('');
    for (const signature of [
      'check(int obtuvo, int esperado)',
      'check(long obtuvo, long esperado)',
      'check(double obtuvo, double esperado)',
      'check(boolean obtuvo, boolean esperado)',
      'check(char obtuvo, char esperado)',
      'check(Object obtuvo, Object esperado)',
      'check(int[] obtuvo, int[] esperado)',
    ]) {
      expect(harness).toContain(signature);
    }
  });

  it('catches a throw so the cases before it still count', () => {
    // A student's method that blows up on case 3 must not erase cases 1 and 2.
    expect(buildHarness('')).toContain('catch (Throwable');
  });
});

describe('readRun', () => {
  it('reads a passing case', () => {
    expect(readRun('[nalanda] PASS 1\n').cases).toEqual([{ n: 1, ok: true }]);
  });

  it('reads a failing case with both values', () => {
    const run = readRun('[nalanda] FAIL 2 :: 4 :: 0\n');
    expect(run.cases).toEqual([{ n: 2, ok: false, expected: '4', actual: '0' }]);
  });

  it("keeps the student's own output apart from the verdicts", () => {
    const run = readRun('estoy depurando\n[nalanda] PASS 1\ny esto también\n');
    expect(run.cases).toHaveLength(1);
    expect(run.output).toBe('estoy depurando\ny esto también');
  });

  it('surfaces a crash without losing the cases that ran first', () => {
    const run = readRun(
      '[nalanda] PASS 1\n[nalanda] ERROR :: java.lang.ArithmeticException: / by zero\n',
    );
    expect(run.cases).toEqual([{ n: 1, ok: true }]);
    expect(run.crash).toContain('ArithmeticException');
  });

  it('reports no crash when there was none', () => {
    expect(readRun('[nalanda] PASS 1\n').crash).toBeNull();
  });

  it('tolerates values containing the field separator', () => {
    // ` :: ` is only a separator for the first two splits; the rest is the value.
    const run = readRun('[nalanda] FAIL 1 :: a :: b :: c\n');
    expect(run.cases[0]).toMatchObject({ ok: false, expected: 'a', actual: 'b :: c' });
  });

  it('finds a verdict that shares a line with the student printing', () => {
    // The harness prints with println, so a student who used print() without a
    // newline is on the same line as the verdict that followed. Reading only the
    // start of the line threw that verdict away — and a swallowed FAIL renders
    // as a pass, which is the one thing this component must never do.
    const run = readRun('dbg[nalanda] FAIL 1 :: true :: false\n[nalanda] PASS 2\n');
    expect(run.cases).toEqual([
      { n: 1, ok: false, expected: 'true', actual: 'false' },
      { n: 2, ok: true },
    ]);
    expect(run.output).toBe('dbg');
  });

  it('drops a case whose number is not a number', () => {
    // Forged or corrupted; either way it rendered as "caso NaN" and every such
    // case collided on the same React key.
    expect(readRun('[nalanda] PASS uno\n[nalanda] FAIL x :: a :: b\n').cases).toEqual([]);
  });

  it('does not report an empty exception message', () => {
    expect(readRun('[nalanda] ERROR\n').crash).toBe('sin detalle');
  });

  it('returns nothing for output with no verdicts at all', () => {
    const run = readRun('el programa no imprimió veredictos\n');
    expect(run.cases).toEqual([]);
    expect(run.output).toBe('el programa no imprimió veredictos');
  });
});
