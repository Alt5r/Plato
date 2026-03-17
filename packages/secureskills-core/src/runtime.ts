import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { chmod, copyFile, lstat, mkdtemp, readdir, readFile, readlink, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PAYLOAD_DIR } from "./constants.ts";
import { loadProject } from "./config.ts";
import { decryptBytes, unwrapContentKey } from "./crypto.ts";
import { ensureDir, pathExists, removeIfExists, sha256Hex, symlinkAbsoluteTarget } from "./fs-utils.ts";
import { verifyProject } from "./verify.ts";
import type { BundleManifest, VerifiedWorkspace } from "./types.ts";

const SYNC_EXCLUDES = new Set([".agents", ".git", ".secureskills", "skills"]);
const RECONCILER_FALLBACK_INTERVAL_MS = 250;

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

interface WorkspaceReconciler {
  refreshCoverage: () => Promise<void>;
  stop: () => Promise<void>;
}

interface RuntimeMutationDetector {
  bindChildProcess: (child: ReturnType<typeof spawn>) => void;
  stop: () => Promise<void>;
}

interface RuntimeIntegritySnapshot {
  directories: Set<string>;
  files: Map<string, string>;
}

const MUTATION_DETECTOR_FALLBACK_INTERVAL_MS = 250;

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
    const liveMirror = startWorkspaceReconciler(workspace.workspaceDir, projectRoot);
    await liveMirror.refreshCoverage();
    await syncWorkspaceEdits(workspace.workspaceDir, projectRoot);
    const mutationDetector = await startRuntimeMutationDetector(workspace.runtimeSkillsDir);
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
      mutationDetector.bindChildProcess(child);

      child.on("error", reject);
      child.on("exit", async (code) => {
        await mutationDetector.stop();
        resolve(code ?? 1);
      });
    });

    await liveMirror.stop();
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
  let currentWorkspaceDir = workspaceDir;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const nextWorkspaceDir = path.join(currentWorkspaceDir, component);
    const sourceDir = path.join(projectRoot, ...components.slice(0, index + 1));

    await removeIfExists(nextWorkspaceDir);
    await ensureDir(nextWorkspaceDir);
    await linkWorkspaceEntries(sourceDir, nextWorkspaceDir);
    await prepareAgentMounts(sourceDir, nextWorkspaceDir, path.join(workspaceDir, ".secureskills", "runtime", "skills"));
    currentWorkspaceDir = nextWorkspaceDir;
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
  await syncWorkspaceDirectory(workspaceDir, projectRoot, projectRoot);
}

function startWorkspaceReconciler(workspaceDir: string, projectRoot: string): WorkspaceReconciler {
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const pendingPaths = new Set<string>();
  let watcherClosed = false;
  let flushScheduled = false;
  let flushInFlight: Promise<void> | null = null;

  function queuePath(targetPath: string): void {
    if (watcherClosed) {
      return;
    }

    pendingPaths.add(targetPath);
    scheduleFlush();
  }

  function scheduleFlush(): void {
    if (flushScheduled || watcherClosed) {
      return;
    }

    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      void flushPendingPaths();
    });
  }

  async function flushPendingPaths(): Promise<void> {
    if (flushInFlight) {
      return flushInFlight;
    }

    const nextBatch = [...pendingPaths];
    if (nextBatch.length === 0) {
      return;
    }
    pendingPaths.clear();

    flushInFlight = (async () => {
      try {
        for (const candidatePath of nextBatch) {
          await reconcileWorkspacePath(candidatePath, workspaceDir, projectRoot);
        }
      } catch {
        // Best-effort during the live session. The final exit sync remains authoritative.
      } finally {
        flushInFlight = null;
        if (pendingPaths.size > 0 && !watcherClosed) {
          scheduleFlush();
        }
      }
    })();

    return flushInFlight;
  }

  function startWatching(directoryPath: string): void {
    if (watchers.has(directoryPath) || watcherClosed) {
      return;
    }

    const watcher = watch(directoryPath, { persistent: false }, async (_eventType, filename) => {
      const changedPath = filename ? path.join(directoryPath, filename.toString()) : directoryPath;
      queuePath(changedPath);

      try {
        const stats = await lstat(changedPath);
        if (stats.isDirectory()) {
          await ensureWatcherCoverage(changedPath);
        }
      } catch {
        // The path may have been deleted before we could inspect it.
      }
    });

    watcher.on("error", () => {
      queuePath(directoryPath);
    });
    watchers.set(directoryPath, watcher);
  }

  async function ensureWatcherCoverage(directoryPath: string): Promise<void> {
    const relativeDirectory = path.relative(workspaceDir, directoryPath);
    if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
      return;
    }

    const normalizedRelativeDirectory = relativeDirectory === "" ? "" : path.normalize(relativeDirectory);
    const rootComponent = normalizedRelativeDirectory.split(path.sep)[0] ?? "";
    if (rootComponent && SYNC_EXCLUDES.has(rootComponent)) {
      return;
    }

    startWatching(directoryPath);

    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || SYNC_EXCLUDES.has(entry.name)) {
        continue;
      }

      await ensureWatcherCoverage(path.join(directoryPath, entry.name));
    }
  }

  void ensureWatcherCoverage(workspaceDir).catch(() => {
    queuePath(workspaceDir);
  });
  const fallbackIntervalId = setInterval(() => {
    queuePath(workspaceDir);
  }, RECONCILER_FALLBACK_INTERVAL_MS);

  return {
    refreshCoverage: async () => {
      await ensureWatcherCoverage(workspaceDir);
    },
    stop: async () => {
      watcherClosed = true;
      clearInterval(fallbackIntervalId);
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
      await flushPendingPaths();
      if (flushInFlight) {
        await flushInFlight;
      }
    },
  };
}

async function startRuntimeMutationDetector(runtimeSkillsDir: string): Promise<RuntimeMutationDetector> {
  const watchers = new Map<string, ReturnType<typeof watch>>();
  let detectorClosed = false;
  const expectedSnapshot = await buildRuntimeIntegritySnapshot(runtimeSkillsDir);
  let reverifyInFlight: Promise<void> | null = null;
  let child: ReturnType<typeof spawn> | null = null;
  let violationMessage: string | null = null;

  function ensureWatcher(directoryPath: string): void {
    if (watchers.has(directoryPath) || detectorClosed) {
      return;
    }

    const watcher = watch(directoryPath, { persistent: false }, async (_eventType, filename) => {
      const changedPath = filename ? path.join(directoryPath, filename.toString()) : directoryPath;
      await reverify(changedPath);
    });

    watcher.on("error", async () => {
      await reverify(runtimeSkillsDir);
    });
    watchers.set(directoryPath, watcher);
  }

  async function ensureCoverage(directoryPath: string): Promise<void> {
    ensureWatcher(directoryPath);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await ensureCoverage(path.join(directoryPath, entry.name));
      }
    }
  }

  async function reverify(_changedPath: string): Promise<void> {
    if (detectorClosed || (child && child.exitCode !== null)) {
      return;
    }

    if (reverifyInFlight) {
      return reverifyInFlight;
    }

    reverifyInFlight = (async () => {
      try {
        const actualSnapshot = await buildRuntimeIntegritySnapshot(runtimeSkillsDir);
        const violation = diffRuntimeIntegrity(expectedSnapshot, actualSnapshot);
        if (!violation) {
          await ensureCoverage(runtimeSkillsDir);
          return;
        }

        await handleViolation(`Plato runtime mutation detected: ${violation}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handleViolation(`Plato runtime mutation detector failed: ${message}`);
      } finally {
        reverifyInFlight = null;
      }
    })();

    return reverifyInFlight;
  }

  async function handleViolation(message: string): Promise<void> {
    if (detectorClosed) {
      return;
    }

    detectorClosed = true;
    violationMessage = message;
    for (const watcher of watchers.values()) {
      watcher.close();
    }
    watchers.clear();
    clearInterval(fallbackIntervalId);
    process.stderr.write(`${message}\n`);
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }

  await ensureCoverage(runtimeSkillsDir);
  const fallbackIntervalId = setInterval(() => {
    void reverify(runtimeSkillsDir);
  }, MUTATION_DETECTOR_FALLBACK_INTERVAL_MS);

  return {
    bindChildProcess: (nextChild) => {
      child = nextChild;
      if (violationMessage && child.exitCode === null) {
        child.kill("SIGTERM");
      }
    },
    stop: async () => {
      detectorClosed = true;
      clearInterval(fallbackIntervalId);
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
      if (reverifyInFlight) {
        await reverifyInFlight;
      }
    },
  };
}

async function reconcileWorkspacePath(candidateWorkspacePath: string, workspaceDir: string, projectRoot: string): Promise<void> {
  const relativePath = path.relative(workspaceDir, candidateWorkspacePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return;
  }

  const normalizedRelativePath = relativePath === "" ? "" : path.normalize(relativePath);
  const rootComponent = normalizedRelativePath.split(path.sep)[0] ?? "";
  if (rootComponent && SYNC_EXCLUDES.has(rootComponent)) {
    return;
  }

  if (normalizedRelativePath === "") {
    await syncWorkspaceEdits(workspaceDir, projectRoot);
    return;
  }

  const projectPath = path.join(projectRoot, normalizedRelativePath);
  assertMirrorPathWithinProject(projectPath, projectRoot);

  const workspaceStats = await lstatOrNull(candidateWorkspacePath);
  if (!workspaceStats) {
    await removeIfExists(projectPath);
    return;
  }

  await syncWorkspaceEntry(candidateWorkspacePath, projectPath, projectRoot);
}

async function syncWorkspaceDirectory(
  workspaceDir: string,
  projectDir: string,
  projectRoot: string,
): Promise<void> {
  assertMirrorPathWithinProject(projectDir, projectRoot);
  const workspaceEntries = await readdir(workspaceDir, { withFileTypes: true });
  const projectEntries = await readdir(projectDir, { withFileTypes: true });
  const workspaceEntriesByName = new Map(
    workspaceEntries
      .filter((entry) => !SYNC_EXCLUDES.has(entry.name))
      .map((entry) => [entry.name, entry]),
  );

  for (const workspaceEntry of workspaceEntries) {
    if (SYNC_EXCLUDES.has(workspaceEntry.name)) {
      continue;
    }

    await syncWorkspaceEntry(
      path.join(workspaceDir, workspaceEntry.name),
      path.join(projectDir, workspaceEntry.name),
      projectRoot,
    );
  }

  for (const projectEntry of projectEntries) {
    if (SYNC_EXCLUDES.has(projectEntry.name)) {
      continue;
    }

    if (!workspaceEntriesByName.has(projectEntry.name)) {
      const missingProjectPath = path.join(projectDir, projectEntry.name);
      assertMirrorPathWithinProject(missingProjectPath, projectRoot);
      await removeIfExists(missingProjectPath);
    }
  }
}

async function syncWorkspaceEntry(
  workspacePath: string,
  projectPath: string,
  projectRoot: string,
): Promise<void> {
  assertMirrorPathWithinProject(projectPath, projectRoot);
  const workspaceStats = await lstat(workspacePath);

  if (workspaceStats.isSymbolicLink()) {
    const linkTarget = await readlink(workspacePath);
    const resolvedTarget = path.resolve(path.dirname(workspacePath), linkTarget);

    if (resolvedTarget === projectPath) {
      return;
    }

    if (isWithinProjectRoot(resolvedTarget, projectRoot)) {
      const workspaceRoot = resolveWorkspaceRootFromPair(workspacePath, projectPath, projectRoot);
      const sourceWorkspacePath = path.join(workspaceRoot, path.relative(projectRoot, resolvedTarget));

      if (await pathExists(sourceWorkspacePath)) {
        await cloneProjectContent(resolvedTarget, projectPath);
      } else {
        await moveProjectContent(resolvedTarget, projectPath);
      }

      await removeIfExists(workspacePath);
      await symlinkAbsoluteTarget(projectPath, workspacePath);
      return;
    }

    throw new Error(
      `Refusing to mirror workspace symlink ${workspacePath} into project path ${projectPath}`,
    );
  }

  if (workspaceStats.isDirectory()) {
    const existingProjectStats = await lstatOrNull(projectPath);
    if (existingProjectStats && !existingProjectStats.isDirectory()) {
      await removeIfExists(projectPath);
    }

    await ensureDir(projectPath);
    await syncWorkspaceDirectory(workspacePath, projectPath, projectRoot);
    return;
  }

  if (workspaceStats.isFile()) {
    await ensureDir(path.dirname(projectPath));
    await copyFileAtomically(workspacePath, projectPath, workspaceStats.mode & 0o777);
    return;
  }

  throw new Error(`Unsupported workspace entry type while syncing edits: ${workspacePath}`);
}

async function lstatOrNull(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch {
    return null;
  }
}

function assertMirrorPathWithinProject(candidatePath: string, projectRoot: string): void {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedProjectRoot = path.resolve(projectRoot);

  if (!isWithinProjectRoot(resolvedCandidate, resolvedProjectRoot)) {
    throw new Error(`Refusing to mirror outside project root: ${candidatePath}`);
  }
}

function isWithinProjectRoot(candidatePath: string, projectRoot: string): boolean {
  if (candidatePath === projectRoot) {
    return true;
  }

  const relativePath = path.relative(projectRoot, candidatePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function copyFileAtomically(sourcePath: string, destinationPath: string, mode: number): Promise<void> {
  const tempDestinationPath = `${destinationPath}.plato-tmp-${process.pid}`;
  await removeIfExists(tempDestinationPath);
  await copyFile(sourcePath, tempDestinationPath);
  await chmod(tempDestinationPath, mode);
  await rename(tempDestinationPath, destinationPath);
}

async function cloneProjectContent(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStats = await lstat(sourcePath);

  if (sourceStats.isSymbolicLink()) {
    throw new Error(`Refusing to clone nested project symlink during reconciliation: ${sourcePath}`);
  }

  if (sourceStats.isDirectory()) {
    await removeIfExists(destinationPath);
    await ensureDir(destinationPath);
    const entries = await readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await cloneProjectContent(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name));
    }
    return;
  }

  if (sourceStats.isFile()) {
    await ensureDir(path.dirname(destinationPath));
    await copyFileAtomically(sourcePath, destinationPath, sourceStats.mode & 0o777);
    return;
  }

  throw new Error(`Unsupported project entry type while cloning reconciled content: ${sourcePath}`);
}

async function moveProjectContent(sourcePath: string, destinationPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) {
    if (await pathExists(destinationPath)) {
      return;
    }
    throw new Error(`Refusing to move missing project content during reconciliation: ${sourcePath}`);
  }

  await ensureDir(path.dirname(destinationPath));
  await removeIfExists(destinationPath);

  try {
    await rename(sourcePath, destinationPath);
  } catch {
    await cloneProjectContent(sourcePath, destinationPath);
    await removeIfExists(sourcePath);
  }
}

function resolveWorkspaceRootFromPair(workspacePath: string, projectPath: string, projectRoot: string): string {
  const relativeProjectPath = path.relative(projectRoot, projectPath);
  if (relativeProjectPath === "") {
    return workspacePath;
  }

  const depth = relativeProjectPath.split(path.sep).filter(Boolean).length;
  return path.resolve(workspacePath, ...Array.from({ length: depth }, () => ".."));
}

async function buildRuntimeIntegritySnapshot(runtimeSkillsDir: string): Promise<RuntimeIntegritySnapshot> {
  const snapshot: RuntimeIntegritySnapshot = {
    directories: new Set<string>(),
    files: new Map<string, string>(),
  };

  async function visit(directoryPath: string, relativeDirectory: string): Promise<void> {
    snapshot.directories.add(relativeDirectory);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name;

      if (entry.isSymbolicLink()) {
        throw new Error(`Unexpected symlink in runtime skill tree: ${relativePath}`);
      }

      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }

      if (entry.isFile()) {
        const contents = await readFile(absolutePath);
        snapshot.files.set(relativePath, sha256Hex(contents));
      }
    }
  }

  await visit(runtimeSkillsDir, "");
  return snapshot;
}

function diffRuntimeIntegrity(expected: RuntimeIntegritySnapshot, actual: RuntimeIntegritySnapshot): string | null {
  for (const expectedDirectory of expected.directories) {
    if (!actual.directories.has(expectedDirectory)) {
      return `runtime directory disappeared: ${expectedDirectory || "."}`;
    }
  }

  for (const actualDirectory of actual.directories) {
    if (!expected.directories.has(actualDirectory)) {
      return `unexpected runtime directory appeared: ${actualDirectory || "."}`;
    }
  }

  for (const [expectedFile, expectedDigest] of expected.files) {
    const actualDigest = actual.files.get(expectedFile);
    if (!actualDigest) {
      return `runtime file disappeared: ${expectedFile}`;
    }
    if (actualDigest !== expectedDigest) {
      return `runtime file changed: ${expectedFile}`;
    }
  }

  for (const actualFile of actual.files.keys()) {
    if (!expected.files.has(actualFile)) {
      return `unexpected runtime file appeared: ${actualFile}`;
    }
  }

  return null;
}
