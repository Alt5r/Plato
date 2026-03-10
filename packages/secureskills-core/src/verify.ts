import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { MANIFEST_FILE, PAYLOAD_DIR, SIGNATURE_FILE, SKILL_MARKER_FILE } from "./constants.ts";
import { loadProject, readLockfile } from "./config.ts";
import { decryptBytes, manifestSha256, unwrapContentKey, verifyManifestSignature } from "./crypto.ts";
import { pathExists, readJsonFile, sha256Hex } from "./fs-utils.ts";
import type { BundleManifest, VerifyBundleResult, VerifyReport } from "./types.ts";

export async function verifyProject(projectRoot: string): Promise<VerifyReport> {
  const project = await loadProject(projectRoot);
  const lockfile = await readLockfile(project);
  const skillNames = Object.keys(lockfile.skills).sort();
  const bundles: VerifyBundleResult[] = [];

  for (const skillName of skillNames) {
    bundles.push(await verifyInstalledSkill(projectRoot, skillName));
  }

  return {
    ok: bundles.every((bundle) => bundle.ok),
    bundles,
    warnings: await scanLooseSkillWarnings(projectRoot),
  };
}

export async function verifyInstalledSkill(projectRoot: string, skillName: string): Promise<VerifyBundleResult> {
  const project = await loadProject(projectRoot);
  const lockfile = await readLockfile(project);
  const bundleDir = path.join(project.paths.storeDir, skillName);
  const manifestPath = path.join(bundleDir, MANIFEST_FILE);
  const signaturePath = path.join(bundleDir, SIGNATURE_FILE);
  const errors: string[] = [];

  if (!(await pathExists(manifestPath))) {
    return {
      skillName,
      ok: false,
      encrypted: false,
      errors: [`Missing manifest for ${skillName}`],
      manifest: null,
    };
  }

  if (!(await pathExists(signaturePath))) {
    return {
      skillName,
      ok: false,
      encrypted: false,
      errors: [`Missing manifest signature for ${skillName}`],
      manifest: null,
    };
  }

  const manifest = await readJsonFile<BundleManifest>(manifestPath);
  const signatureBase64 = (await readFile(signaturePath, "utf8")).trim();

  if (!verifyManifestSignature(manifest, signatureBase64, project.signingPublicKeyPem)) {
    errors.push("Manifest signature verification failed");
  }

  const lockEntry = lockfile.skills[skillName];
  if (lockEntry && manifestSha256(manifest) !== lockEntry.manifestSha256) {
    errors.push("Lockfile manifest digest mismatch");
  }

  let contentKey: Buffer | null = null;
  if (manifest.encryption.enabled && manifest.encryption.wrappedKey) {
    try {
      contentKey = unwrapContentKey(manifest.encryption.wrappedKey, project.masterKey);
    } catch (error) {
      errors.push(`Failed to unwrap content key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const fileEntry of manifest.files) {
    const storedFilePath = path.join(bundleDir, PAYLOAD_DIR, fileEntry.storedPath);
    if (!(await pathExists(storedFilePath))) {
      errors.push(`Missing payload file ${fileEntry.storedPath}`);
      continue;
    }

    const storedBytes = await readFile(storedFilePath);
    if (sha256Hex(storedBytes) !== fileEntry.storedSha256) {
      errors.push(`Stored digest mismatch for ${fileEntry.relativePath}`);
      continue;
    }

    let plaintext: Buffer;
    try {
      plaintext = contentKey
        ? decryptBytes(storedBytes, contentKey, fileEntry.relativePath)
        : storedBytes;
    } catch (error) {
      errors.push(`Failed to decrypt ${fileEntry.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (sha256Hex(plaintext) !== fileEntry.plaintextSha256) {
      errors.push(`Plaintext digest mismatch for ${fileEntry.relativePath}`);
    }
  }

  return {
    skillName,
    ok: errors.length === 0,
    encrypted: manifest.encryption.enabled,
    errors,
    manifest,
  };
}

async function scanLooseSkillWarnings(projectRoot: string): Promise<string[]> {
  const warnings: string[] = [];
  for (const relativeRoot of [".agents/skills", "skills"]) {
    const absoluteRoot = path.join(projectRoot, relativeRoot);
    if (!(await pathExists(absoluteRoot))) {
      continue;
    }

    const matches = await findLooseSkillMarkers(absoluteRoot, relativeRoot);
    warnings.push(...matches.map((match) => `Loose skill file ignored by runtime: ${match}`));
  }

  return warnings;
}

async function findLooseSkillMarkers(directory: string, relativeDirectory: string): Promise<string[]> {
  const matches: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const nextAbsolutePath = path.join(directory, entry.name);
    const nextRelativePath = path.posix.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      matches.push(...await findLooseSkillMarkers(nextAbsolutePath, nextRelativePath));
      continue;
    }

    if (entry.isFile() && entry.name === SKILL_MARKER_FILE) {
      matches.push(nextRelativePath);
    }
  }

  return matches;
}
