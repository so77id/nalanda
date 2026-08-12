#!/usr/bin/env node
// Downloads the Java compiler the browser runtime needs into public/.
//
// It is a build input, not source: ~2.9MB of binary that would sit in git
// forever otherwise. ECJ rather than the JDK's own tools.jar because it is a
// sixth of the size.
//
// 3.21 specifically because its own classes are Java 8 bytecode (major 52), so
// it RUNS on the only CheerpJ runtime that can compile at all — newer ECJ
// builds need a newer JVM. It is not that 3.21 predates the module system's
// jrt lookup: it performs that lookup too, and fails on CheerpJ 11/17 exactly
// as 3.33+ does, because those images ship no jrt-fs.jar (ADR-0017 §2).
//
// The digest is pinned HERE rather than fetched. Maven serves the .sha1 from
// the same origin as the .jar over the same channel, so fetching it detects
// corruption and nothing else — and an earlier version of this script fetched
// it, skipped verification whenever that fetch failed, and trusted any file
// already sitting at the target path. Both paths now verify unconditionally.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ECJ_VERSION = '3.21.0';
/** sha256 of ecj-3.21.0.jar from Maven Central, verified 2026-08-11 (2989263 bytes). */
const ECJ_SHA256 = '9082211f48782750093f07822d1ae481e8ece250449578f372334da626ccdead';
const JAR_URL = `https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/${ECJ_VERSION}/ecj-${ECJ_VERSION}.jar`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'java-compiler.jar');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function cachedDigest(path) {
  try {
    return digest(await readFile(path));
  } catch {
    return null;
  }
}

// A cached jar is trusted only if it hashes to the pinned digest: a truncated
// download, a tampered file, or a stale jar left behind by an ECJ_VERSION bump
// all fail here and are replaced.
if ((await cachedDigest(target)) === ECJ_SHA256) {
  console.log(`java-compiler.jar already present and verified (ecj ${ECJ_VERSION})`);
  process.exit(0);
}

console.log(`downloading ecj ${ECJ_VERSION}…`);
const response = await fetch(JAR_URL);
if (!response.ok) {
  throw new Error(`could not download ${JAR_URL}: ${response.status} ${response.statusText}`);
}
const bytes = Buffer.from(await response.arrayBuffer());

const actual = digest(bytes);
if (actual !== ECJ_SHA256) {
  throw new Error(
    `checksum mismatch for ecj ${ECJ_VERSION}: expected ${ECJ_SHA256}, got ${actual}. ` +
      'Nothing was written. If the ECJ version was just changed, update ECJ_SHA256 too.',
  );
}

await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log(`wrote ${target} (${(bytes.length / 1024 / 1024).toFixed(1)} MB, sha256 verified)`);
