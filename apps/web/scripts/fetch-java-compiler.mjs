#!/usr/bin/env node
// Downloads the Java compiler the browser runtime needs into public/.
//
// It is a build input, not source: ~2.9MB of binary that would sit in git
// forever otherwise. ECJ rather than the JDK's own tools.jar because it is a
// sixth of the size, and because modern ECJ releases cannot run under CheerpJ
// at all — they look for a jrt filesystem the JVM-in-the-browser does not
// expose. 3.21.0 is the last line that uses the classic classpath model
// (verified in a browser spike, 2026-08-11; see ADR-0016).

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ECJ_VERSION = '3.21.0';
const URL = `https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/${ECJ_VERSION}/ecj-${ECJ_VERSION}.jar`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'java-compiler.jar');

async function sha256(path) {
  try {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  } catch {
    return null;
  }
}

const expected = await fetch(`${URL}.sha1`).then(
  (response) => (response.ok ? response.text() : null),
  () => null,
);

if (await sha256(target)) {
  console.log(`java-compiler.jar already present (ecj ${ECJ_VERSION})`);
  process.exit(0);
}

console.log(`downloading ecj ${ECJ_VERSION}…`);
const response = await fetch(URL);
if (!response.ok) {
  throw new Error(`could not download ${URL}: ${response.status} ${response.statusText}`);
}
const bytes = Buffer.from(await response.arrayBuffer());

if (expected) {
  const actual = createHash('sha1').update(bytes).digest('hex');
  if (actual !== expected.trim()) {
    throw new Error(
      `checksum mismatch for ecj ${ECJ_VERSION}: expected ${expected.trim()}, got ${actual}`,
    );
  }
}

await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log(`wrote ${target} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
