import { spawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdtemp, readdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PAYLOAD_DIR } from "./constants.ts";
import { loadProject } from "./config.ts";
import { decryptBytes, unwrapContentKey } from "./crypto.ts";
import { ensureDir, pathExists, removeIfExists, symlinkAbsoluteTarget } from "./fs-utils.ts";
import { verifyProject } from "./verify.ts";
import type { BundleManifest, VerifiedWorkspace } from "./types.ts";

const ROOT_SYNC_EXCLUDES = new Set([".agents", ".git", ".secureskills", "skills"]);

export async function createVerifiedWorkspace(projectRoot: string): Promise<VerifiedWorkspace> {
  const report = await verifyProject(projectRoot);
  const failedBundles = report.bundles.filter((bundle) => !bundle.ok);
  if (failedBundles.length > 0) {
    const names = failedBundles.map((bundle) => bundle.skillName).join(", ");
    throw new Error(`Refusing to materialize runtime because verification failed for: ${names}`);
  }

  const project = await loadProject(projectRoot);
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "secureskills-workspace-"));
  const secureSkillsDir = path.join(workspaceDir, ".secureskills");
  const runtimeSkillsDir = path.join(secureSkillsDir, "runtime", "skills");

  await linkWorkspaceEntries(projectRoot, workspaceDir);
  await ensureDir(secureSkillsDir);
  await linkSecureskillsMetadata(projectRoot, secureSkillsDir);
  await ensureDir(runtimeSkillsDir);

  for (const bundle of report.bundles) {
    await materializeBundle(project, bundle.manifest!, runtimeSkillsDir);
  }

  await prepareAgentMounts(projectRoot, workspaceDir, runtimeSkillsDir);

  return {
    workspaceDir,
    runtimeSkillsDir,
    cleanup: async () => {
      await removeIfExists(workspaceDir);
    },
  };
}

interface RunAgentOptions {
  launchFromDir?: string;
  env?: NodeJS.ProcessEnv;
}

export async function runAgentCommand(
  projectRoot: string,
  command: string[],
  options: RunAgentOptions = {},
): Promise<number> {
  if (command.length === 0) {
    throw new Error("Missing command after --");
  }

  const workspace = await createVerifiedWorkspace(projectRoot);
  try {
    await materializeLaunchPath(projectRoot, workspace.workspaceDir, options.launchFromDir);
    const launchCwd = resolveLaunchWorkingDirectory(projectRoot, workspace.workspaceDir, options.launchFromDir);
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: launchCwd,
        stdio: "inherit",
        env: {
          ...process.env,
          ...options.env,
          SECURESKILLS_RUNTIME_DIR: workspace.runtimeSkillsDir,
          SECURESKILLS_WORKSPACE_DIR: workspace.workspaceDir,
          SECURESKILLS_ORIGINAL_CWD: options.launchFromDir ?? projectRoot,
        },
      });

      child.on("error", reject);
      child.on("exit", (code) => {
        resolve(code ?? 1);
      });
    });

    await syncWorkspaceEdits(workspace.workspaceDir, projectRoot);
    return exitCode;
  } finally {
    await workspace.cleanup();
  }
}

async function materializeLaunchPath(projectRoot: string, workspaceDir: string, launchFromDir?: string): Promise<void> {
  if (!launchFromDir) {
    return;
  }

  const relativePath = path.relative(projectRoot, launchFromDir);
  if (relativePath === "") {
    return;
  }

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Launch directory ${launchFromDir} is outside the secured project root ${projectRoot}`);
  }

  const components = relativePath.split(path.sep).filter(Boolean);
  let sourceDir = projectRoot;
  let targetDir = workspaceDir;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    sourceDir = path.join(sourceDir, component);
    targetDir = path.join(targetDir, component);

    await removeIfExists(targetDir);
    await ensureDir(targetDir);

    const entries = await readdir(sourceDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    const nextComponent = components[index + 1];
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.name === nextComponent && entry.isDirectory()) {
        continue;
      }

      await symlinkAbsoluteTarget(sourcePath, targetPath);
    }
  }
}

function resolveLaunchWorkingDirectory(projectRoot: string, workspaceDir: string, launchFromDir?: string): string {
  if (!launchFromDir) {
    return workspaceDir;
  }

  const relativePath = path.relative(projectRoot, launchFromDir);
  if (relativePath === "") {
    return workspaceDir;
  }

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Launch directory ${launchFromDir} is outside the secured project root ${projectRoot}`);
  }

  return path.join(workspaceDir, relativePath);
}

async function linkWorkspaceEntries(projectRoot: string, workspaceDir: string): Promise<void> {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.name === ".agents" || entry.name === ".secureskills" || entry.name === "skills") {
      continue;
    }

    await symlinkAbsoluteTarget(path.join(projectRoot, entry.name), path.join(workspaceDir, entry.name));
  }
}

async function linkSecureskillsMetadata(projectRoot: string, workspaceSecureSkillsDir: string): Promise<void> {
  const originalSecureSkillsDir = path.join(projectRoot, ".secureskills");
  if (!(await pathExists(originalSecureSkillsDir))) {
    return;
  }

  for (const entryName of ["config.json", "keys", "lock.json", "store"]) {
    const sourcePath = path.join(originalSecureSkillsDir, entryName);
    if (await pathExists(sourcePath)) {
      await symlinkAbsoluteTarget(sourcePath, path.join(workspaceSecureSkillsDir, entryName));
    }
  }
}

async function prepareAgentMounts(
  projectRoot: string,
  workspaceDir: string,
  runtimeSkillsDir: string,
): Promise<void> {
  const workspaceAgentsDir = path.join(workspaceDir, ".agents");
  await ensureDir(workspaceAgentsDir);

  const originalAgentsDir = path.join(projectRoot, ".agents");
  if (await pathExists(originalAgentsDir)) {
    const agentEntries = await readdir(originalAgentsDir, { withFileTypes: true });
    agentEntries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of agentEntries) {
      if (entry.name === "skills") {
        continue;
      }
      await symlinkAbsoluteTarget(
        path.join(originalAgentsDir, entry.name),
        path.join(workspaceAgentsDir, entry.name),
      );
    }
  }

  await symlinkAbsoluteTarget(runtimeSkillsDir, path.join(workspaceAgentsDir, "skills"));
  await symlinkAbsoluteTarget(runtimeSkillsDir, path.join(workspaceDir, "skills"));
}

async function materializeBundle(
  project: Awaited<ReturnType<typeof loadProject>>,
  manifest: BundleManifest,
  runtimeSkillsDir: string,
): Promise<void> {
  const bundleDir = path.join(project.paths.storeDir, manifest.skillName);
  const skillRoot = path.join(runtimeSkillsDir, manifest.skillName);
  await ensureDir(skillRoot);

  const contentKey = manifest.encryption.enabled && manifest.encryption.wrappedKey
    ? unwrapContentKey(manifest.encryption.wrappedKey, project.masterKey)
    : null;

  for (const fileEntry of manifest.files) {
    const storedFilePath = path.join(bundleDir, PAYLOAD_DIR, fileEntry.storedPath);
    const destinationPath = path.join(skillRoot, fileEntry.relativePath);
    const storedBytes = await readFile(storedFilePath);
    const plaintext = contentKey
      ? decryptBytes(storedBytes, contentKey, fileEntry.relativePath)
      : storedBytes;

    await ensureDir(path.dirname(destinationPath));
    await writeFile(destinationPath, plaintext);
  }
}

async function syncWorkspaceEdits(workspaceDir: string, projectRoot: string): Promise<void> {
  await syncWorkspaceDirectory(workspaceDir, projectRoot, projectRoot, true);
}

async function syncWorkspaceDirectory(
  workspaceDir: string,
  projectDir: string,
  projectRoot: string,
  isRoot: boolean,
): Promise<void> {
  const workspaceEntries = await readdir(workspaceDir, { withFileTypes: true });
  const projectEntries = await readdir(projectDir, { withFileTypes: true });
  const excludedNames = isRoot ? ROOT_SYNC_EXCLUDES : null;
  const workspaceEntriesByName = new Map(
    workspaceEntries
      .filter((entry) => !excludedNames?.has(entry.name))
      .map((entry) => [entry.name, entry]),
  );

  for (const workspaceEntry of workspaceEntries) {
    if (excludedNames?.has(workspaceEntry.name)) {
      continue;
    }

    await syncWorkspaceEntry(
      path.join(workspaceDir, workspaceEntry.name),
      path.join(projectDir, workspaceEntry.name),
      projectRoot,
    );
  }

  for (const projectEntry of projectEntries) {
    if (excludedNames?.has(projectEntry.name)) {
      continue;
    }

    if (!workspaceEntriesByName.has(projectEntry.name)) {
      await removeIfExists(path.join(projectDir, projectEntry.name));
    }
  }
}

async function syncWorkspaceEntry(
  workspacePath: string,
  projectPath: string,
  projectRoot: string,
): Promise<void> {
  const workspaceStats = await lstat(workspacePath);

  if (workspaceStats.isSymbolicLink()) {
    const linkTarget = await readlink(workspacePath);
    const resolvedTarget = path.resolve(path.dirname(workspacePath), linkTarget);

    if (resolvedTarget === projectPath) {
      return;
    }

    if (isWithinProjectRoot(resolvedTarget, projectRoot)) {
      await clonePath(resolvedTarget, projectPath);
      return;
    }

    await removeIfExists(projectPath);
    await ensureDir(path.dirname(projectPath));
    await symlink(linkTarget, projectPath);
    return;
  }

  if (workspaceStats.isDirectory()) {
    const existingProjectStats = await lstatOrNull(projectPath);
    if (existingProjectStats && !existingProjectStats.isDirectory()) {
      await removeIfExists(projectPath);
    }

    await ensureDir(projectPath);
    await syncWorkspaceDirectory(workspacePath, projectPath, projectRoot, false);
    return;
  }

  if (workspaceStats.isFile()) {
    await removeIfExists(projectPath);
    await ensureDir(path.dirname(projectPath));
    await copyFile(workspacePath, projectPath);
    await chmod(projectPath, workspaceStats.mode & 0o777);
    return;
  }

  throw new Error(`Unsupported workspace entry type while syncing edits: ${workspacePath}`);
}

async function clonePath(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStats = await lstat(sourcePath);

  if (sourceStats.isSymbolicLink()) {
    const linkTarget = await readlink(sourcePath);
    await removeIfExists(destinationPath);
    await ensureDir(path.dirname(destinationPath));
    await symlink(linkTarget, destinationPath);
    return;
  }

  if (sourceStats.isDirectory()) {
    await removeIfExists(destinationPath);
    await ensureDir(destinationPath);
    const entries = await readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await clonePath(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name));
    }
    return;
  }

  if (sourceStats.isFile()) {
    await removeIfExists(destinationPath);
    await ensureDir(path.dirname(destinationPath));
    await copyFile(sourcePath, destinationPath);
    await chmod(destinationPath, sourceStats.mode & 0o777);
    return;
  }

  throw new Error(`Unsupported source entry type while cloning path: ${sourcePath}`);
}

async function lstatOrNull(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch {
    return null;
  }
}

function isWithinProjectRoot(candidatePath: string, projectRoot: string): boolean {
  if (candidatePath === projectRoot) {
    return true;
  }

  const relativePath = path.relative(projectRoot, candidatePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
