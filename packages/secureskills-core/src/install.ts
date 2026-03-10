import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { MANIFEST_FILE, PAYLOAD_DIR, SIGNATURE_FILE } from "./constants.ts";
import { loadProject, readLockfile, writeLockfile } from "./config.ts";
import { encryptBytes, manifestSha256, signManifest, wrapContentKey } from "./crypto.ts";
import { ensureDir, listFilesRecursive, pathExists, removeIfExists, sha256Hex, writeJsonFile } from "./fs-utils.ts";
import { findSkillDirectory, resolveSource } from "./source.ts";
import type { AddSkillOptions, AddSkillResult, BundleManifest, LockfileEntry } from "./types.ts";

export async function addSkill(
  projectRoot: string,
  sourceRef: string,
  skillName: string,
  options: AddSkillOptions = {},
): Promise<AddSkillResult> {
  const project = await loadProject(projectRoot);
  const resolvedSource = await resolveSource(projectRoot, sourceRef);
  const stageDirectory = path.join(project.paths.storeDir, `.stage-${skillName}-${randomUUID()}`);
  const destinationDirectory = path.join(project.paths.storeDir, skillName);
  const payloadDirectory = path.join(stageDirectory, PAYLOAD_DIR);

  try {
    const skillDirectory = await findSkillDirectory(resolvedSource.directory, skillName);
    if (!skillDirectory) {
      throw new Error(`Could not find skill "${skillName}" in source ${sourceRef}`);
    }

    await ensureDir(payloadDirectory);
    const files = await listFilesRecursive(skillDirectory);
    if (files.length === 0) {
      throw new Error(`Skill "${skillName}" does not contain any files`);
    }

    const encrypted = options.encrypt ?? project.config.defaults.encrypt;
    const installedAt = new Date().toISOString();
    const fileEntries: BundleManifest["files"] = [];
    const contentKey = encrypted ? randomBytes(32) : null;
    const wrappedKey = contentKey ? wrapContentKey(contentKey, project.masterKey) : null;

    for (const relativePath of files) {
      const sourceFile = path.join(skillDirectory, relativePath);
      const destinationFile = path.join(payloadDirectory, relativePath);
      const plaintext = await readFile(sourceFile);
      const storedBytes = contentKey ? encryptBytes(plaintext, contentKey, relativePath) : plaintext;

      await ensureDir(path.dirname(destinationFile));
      await writeFile(destinationFile, storedBytes);

      fileEntries.push({
        relativePath,
        storedPath: relativePath,
        plaintextSha256: sha256Hex(plaintext),
        storedSha256: sha256Hex(storedBytes),
        plaintextSize: plaintext.length,
        storedSize: storedBytes.length,
      });
    }

    const manifest: BundleManifest = {
      version: 1,
      skillName,
      source: {
        type: resolvedSource.type,
        ref: resolvedSource.ref,
      },
      installedAt,
      signatureAlgorithm: "ed25519",
      encryption: {
        enabled: encrypted,
        fileAlgorithm: encrypted ? "aes-256-gcm" : null,
        wrappedKey,
      },
      files: fileEntries,
    };

    const signature = signManifest(manifest, project.signingPrivateKeyPem);
    await writeJsonFile(path.join(stageDirectory, MANIFEST_FILE), manifest);
    await writeFile(path.join(stageDirectory, SIGNATURE_FILE), `${signature}\n`, "utf8");

    const backupDirectory = await replaceExistingBundle(destinationDirectory, stageDirectory);
    if (backupDirectory) {
      await removeIfExists(backupDirectory);
    }

    const lockfile = await readLockfile(project);
    const lockEntry: LockfileEntry = {
      skillName,
      sourceType: resolvedSource.type,
      sourceRef: resolvedSource.ref,
      installedAt,
      manifestSha256: manifestSha256(manifest),
      encrypted,
    };
    lockfile.skills[skillName] = lockEntry;
    await writeLockfile(project, lockfile);

    return {
      skillName,
      encrypted,
      sourceType: resolvedSource.type,
      sourceRef: resolvedSource.ref,
      destination: destinationDirectory,
      manifestSha256: lockEntry.manifestSha256,
    };
  } finally {
    await resolvedSource.cleanup();
    await removeIfExists(stageDirectory);
  }
}

async function replaceExistingBundle(destinationDirectory: string, stageDirectory: string): Promise<string | null> {
  const backupDirectory = `${destinationDirectory}.backup`;

  if (await pathExists(destinationDirectory)) {
    await removeIfExists(backupDirectory);
    await rename(destinationDirectory, backupDirectory);
  }

  try {
    await rename(stageDirectory, destinationDirectory);
  } catch (error) {
    if (await pathExists(backupDirectory)) {
      await rename(backupDirectory, destinationDirectory);
    }
    throw error;
  }

  return (await pathExists(backupDirectory)) ? backupDirectory : null;
}
