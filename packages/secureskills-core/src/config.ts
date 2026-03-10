import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CONFIG_FILE,
  CONFIG_VERSION,
  KEYS_DIR,
  LOCK_FILE,
  LOCKFILE_VERSION,
  MASTER_KEY_FILE,
  RUNTIME_DIR,
  SECURESKILLS_DIR,
  SIGNING_PRIVATE_KEY_FILE,
  SIGNING_PUBLIC_KEY_FILE,
  STORE_DIR,
  SUPPORTED_RUNTIME_SKILL_PATHS,
} from "./constants.ts";
import { generateMasterKey, generateSigningKeyPair } from "./crypto.ts";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "./fs-utils.ts";
import type { Lockfile, ProjectConfig, ProjectContext, ProjectPaths, SetupOptions, SetupResult } from "./types.ts";

export function resolveProjectPaths(rootDir: string): ProjectPaths {
  const secureSkillsDir = path.join(rootDir, SECURESKILLS_DIR);
  const keysDir = path.join(secureSkillsDir, KEYS_DIR);
  return {
    rootDir,
    secureSkillsDir,
    configPath: path.join(secureSkillsDir, CONFIG_FILE),
    lockPath: path.join(secureSkillsDir, LOCK_FILE),
    keysDir,
    storeDir: path.join(secureSkillsDir, STORE_DIR),
    runtimeDir: path.join(secureSkillsDir, RUNTIME_DIR),
    signingPrivateKeyPath: path.join(keysDir, SIGNING_PRIVATE_KEY_FILE),
    signingPublicKeyPath: path.join(keysDir, SIGNING_PUBLIC_KEY_FILE),
    masterKeyPath: path.join(keysDir, MASTER_KEY_FILE),
  };
}

export async function setupProject(rootDir: string, options: SetupOptions = {}): Promise<SetupResult> {
  const paths = resolveProjectPaths(rootDir);
  if (await pathExists(paths.configPath)) {
    throw new Error(`SecureSkills is already initialized in ${rootDir}`);
  }

  await ensureDir(paths.keysDir);
  await ensureDir(paths.storeDir);
  await ensureDir(paths.runtimeDir);

  const keyPair = generateSigningKeyPair();
  const masterKey = generateMasterKey();

  const config: ProjectConfig = {
    version: CONFIG_VERSION,
    createdAt: new Date().toISOString(),
    defaults: {
      encrypt: Boolean(options.encryptByDefault),
    },
    runtime: {
      skillMountPaths: [...SUPPORTED_RUNTIME_SKILL_PATHS],
    },
  };

  const lockfile: Lockfile = {
    version: LOCKFILE_VERSION,
    updatedAt: new Date().toISOString(),
    skills: {},
  };

  await writeJsonFile(paths.configPath, config);
  await writeJsonFile(paths.lockPath, lockfile);
  await writeFile(paths.signingPrivateKeyPath, keyPair.privateKeyPem, "utf8");
  await writeFile(paths.signingPublicKeyPath, keyPair.publicKeyPem, "utf8");
  await writeFile(paths.masterKeyPath, masterKey.toString("base64"), "utf8");

  return {
    rootDir,
    secureSkillsDir: paths.secureSkillsDir,
    encryptByDefault: config.defaults.encrypt,
  };
}

export async function isProjectInitialized(rootDir: string): Promise<boolean> {
  const paths = resolveProjectPaths(rootDir);
  return pathExists(paths.configPath);
}

export async function ensureProject(rootDir: string): Promise<{ project: ProjectContext; initializedProject: boolean }> {
  const initializedProject = !(await isProjectInitialized(rootDir));
  if (initializedProject) {
    await setupProject(rootDir);
  }

  return {
    project: await loadProject(rootDir),
    initializedProject,
  };
}

export async function loadProject(rootDir: string): Promise<ProjectContext> {
  const paths = resolveProjectPaths(rootDir);
  if (!(await pathExists(paths.configPath))) {
    throw new Error(`SecureSkills is not initialized in ${rootDir}. Run "secureskills setup" first.`);
  }

  const config = await readJsonFile<ProjectConfig>(paths.configPath);
  const signingPrivateKeyPem = await readFile(paths.signingPrivateKeyPath, "utf8");
  const signingPublicKeyPem = await readFile(paths.signingPublicKeyPath, "utf8");
  const masterKeyBase64 = await readFile(paths.masterKeyPath, "utf8");

  return {
    rootDir,
    paths,
    config,
    signingPrivateKeyPem,
    signingPublicKeyPem,
    masterKey: Buffer.from(masterKeyBase64.trim(), "base64"),
  };
}

export async function readLockfile(project: ProjectContext): Promise<Lockfile> {
  if (!(await pathExists(project.paths.lockPath))) {
    return {
      version: LOCKFILE_VERSION,
      updatedAt: new Date().toISOString(),
      skills: {},
    };
  }

  return readJsonFile<Lockfile>(project.paths.lockPath);
}

export async function writeLockfile(project: ProjectContext, lockfile: Lockfile): Promise<void> {
  await writeJsonFile(project.paths.lockPath, {
    ...lockfile,
    updatedAt: new Date().toISOString(),
  });
}
