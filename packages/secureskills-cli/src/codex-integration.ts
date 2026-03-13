import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ensureProject, runAgentCommand } from "../../secureskills-core/src/index.ts";
import { pathExists, removeIfExists, writeJsonFile } from "../../secureskills-core/src/fs-utils.ts";

export type SupportedAgent = "codex" | "claude";

export const SUPPORTED_AGENTS: SupportedAgent[] = ["codex", "claude"];

interface AgentDefinition {
  id: SupportedAgent;
  displayName: string;
  binaryName: string;
  profileBlockStart: string;
  profileBlockEnd: string;
  shellHookFilename: string;
  realPathFilename: string;
  bypassEnvVar: string;
  realPathEnvVar: string;
}

const AGENT_DEFINITIONS: Record<SupportedAgent, AgentDefinition> = {
  codex: {
    id: "codex",
    displayName: "Codex",
    binaryName: "codex",
    profileBlockStart: "# >>> Plato Codex integration >>>",
    profileBlockEnd: "# <<< Plato Codex integration <<<",
    shellHookFilename: "codex.zsh",
    realPathFilename: "codex-path",
    bypassEnvVar: "PLATO_CODEX_BYPASS",
    realPathEnvVar: "PLATO_CODEX_REAL_PATH",
  },
  claude: {
    id: "claude",
    displayName: "Claude",
    binaryName: "claude",
    profileBlockStart: "# >>> Plato Claude integration >>>",
    profileBlockEnd: "# <<< Plato Claude integration <<<",
    shellHookFilename: "claude.zsh",
    realPathFilename: "claude-path",
    bypassEnvVar: "PLATO_CLAUDE_BYPASS",
    realPathEnvVar: "PLATO_CLAUDE_REAL_PATH",
  },
};

interface AgentIntegrationMarker {
  version: number;
  enabledAt: string;
}

export interface AgentIntegrationOptions {
  platoHomeDir?: string;
  shellProfilePath?: string;
  realBinaryPath?: string;
}

export interface AgentEnableResult {
  agent: SupportedAgent;
  repoRoot: string;
  initializedProject: boolean;
  shellHookPath: string;
  shellProfilePath: string;
  realBinaryPath: string;
  shellHookUpdated: boolean;
}

export interface AgentDisableResult {
  agent: SupportedAgent;
  repoRoot: string;
  disabled: boolean;
}

export interface AgentDoctorReport {
  agent: SupportedAgent;
  repoRoot: string | null;
  repoEnabled: boolean;
  shellHookPath: string;
  shellHookInstalled: boolean;
  shellProfilePath: string;
  shellProfileConfigured: boolean;
  realBinaryPathFile: string;
  realBinaryPath: string | null;
  realBinaryPathUsable: boolean;
  issues: string[];
}

export interface AgentShellInstallResult {
  agent: SupportedAgent;
  shellHookPath: string;
  shellProfilePath: string;
  realBinaryPath: string;
  shellHookUpdated: boolean;
}

interface AgentIntegrationPaths {
  platoHomeDir: string;
  shellDir: string;
  metadataDir: string;
  shellHookPath: string;
  realBinaryPathFile: string;
  shellProfilePathFile: string;
}

export function defaultPlatoHomeDir(): string {
  return process.env.PLATO_HOME ?? path.join(homedir(), ".config", "plato");
}

export function defaultShellProfilePath(): string {
  return process.env.PLATO_SHELL_PROFILE ?? path.join(homedir(), ".zshrc");
}

export function formatAgentDisplayName(agent: SupportedAgent): string {
  return agentDefinition(agent).displayName;
}

export function isSupportedAgent(value: string): value is SupportedAgent {
  return SUPPORTED_AGENTS.includes(value as SupportedAgent);
}

function agentDefinition(agent: SupportedAgent): AgentDefinition {
  return AGENT_DEFINITIONS[agent];
}

function resolveIntegrationPaths(agent: SupportedAgent, options: AgentIntegrationOptions = {}): AgentIntegrationPaths {
  const definition = agentDefinition(agent);
  const platoHomeDir = options.platoHomeDir ?? defaultPlatoHomeDir();
  return {
    platoHomeDir,
    shellDir: path.join(platoHomeDir, "shell"),
    metadataDir: path.join(platoHomeDir, "metadata"),
    shellHookPath: path.join(platoHomeDir, "shell", definition.shellHookFilename),
    realBinaryPathFile: path.join(platoHomeDir, "metadata", definition.realPathFilename),
    shellProfilePathFile: path.join(platoHomeDir, "metadata", `${agent}-shell-profile`),
  };
}

function integrationMarkerPath(agent: SupportedAgent, repoRoot: string): string {
  return path.join(repoRoot, ".secureskills", "integrations", `${agent}.json`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function ensureIntegrationDirectories(paths: AgentIntegrationPaths): Promise<void> {
  await mkdir(paths.shellDir, { recursive: true });
  await mkdir(paths.metadataDir, { recursive: true });
}

async function readStoredShellProfilePath(paths: AgentIntegrationPaths): Promise<string | null> {
  if (!(await pathExists(paths.shellProfilePathFile))) {
    return null;
  }

  return (await readFile(paths.shellProfilePathFile, "utf8")).trim() || null;
}

async function readStoredRealBinaryPath(paths: AgentIntegrationPaths): Promise<string | null> {
  if (!(await pathExists(paths.realBinaryPathFile))) {
    return null;
  }

  return (await readFile(paths.realBinaryPathFile, "utf8")).trim() || null;
}

async function fileIsExecutable(targetPath: string | null): Promise<boolean> {
  if (!targetPath) {
    return false;
  }

  try {
    const stats = await stat(targetPath);
    if (!stats.isFile()) {
      return false;
    }
    await access(targetPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveRealBinaryPath(
  agent: SupportedAgent,
  paths: AgentIntegrationPaths,
  options: AgentIntegrationOptions = {},
): Promise<string> {
  const definition = agentDefinition(agent);
  const candidatePaths = [
    options.realBinaryPath,
    process.env[definition.realPathEnvVar],
    process.env.PLATO_REAL_BINARY_PATH,
    await readStoredRealBinaryPath(paths),
  ];

  for (const candidate of candidatePaths) {
    if (await fileIsExecutable(candidate ?? null)) {
      return candidate!;
    }
  }

  const lookup = spawnSync(process.env.SHELL ?? "/bin/sh", ["-lc", `command -v ${definition.binaryName}`], {
    encoding: "utf8",
    env: process.env,
  });

  if (lookup.error) {
    throw lookup.error;
  }

  const resolved = lookup.stdout.trim();
  if (lookup.status === 0 && resolved) {
    return resolved;
  }

  throw new Error(
    `Could not find the real "${definition.binaryName}" binary on PATH. Install ${definition.displayName} first, then run "secureskills enable ${agent}".`,
  );
}

function shellHookContents(agent: SupportedAgent, paths: AgentIntegrationPaths): string {
  const definition = agentDefinition(agent);
  const variablePrefix = `_plato_${definition.binaryName}`;

  return `# Generated by Plato. Safe to recreate.\n${variablePrefix}_real_path_file=${shellQuote(paths.realBinaryPathFile)}\n\n${variablePrefix}_real_bin() {\n  if [[ ! -f "$${variablePrefix}_real_path_file" ]]; then\n    return 1\n  fi\n\n  local plato_real_binary\n  IFS= read -r plato_real_binary < "$${variablePrefix}_real_path_file" || return 1\n  if [[ -z "$plato_real_binary" || ! -x "$plato_real_binary" ]]; then\n    return 1\n  fi\n\n  printf '%s\\n' "$plato_real_binary"\n}\n\n${definition.binaryName}() {\n  local plato_real_binary\n  if ! plato_real_binary="$(${variablePrefix}_real_bin)"; then\n    echo "Plato: real ${definition.binaryName} path is missing. Run 'secureskills doctor ${agent}'." >&2\n    return 127\n  fi\n\n  if [[ -n "\${${definition.bypassEnvVar}:-}" ]]; then\n    command "$plato_real_binary" "$@"\n    return $?\n  fi\n\n  if command -v secureskills >/dev/null 2>&1; then\n    secureskills launch ${agent} -- "$@"\n    return $?\n  fi\n\n  command "$plato_real_binary" "$@"\n}\n`;
}

function profileSourceBlock(agent: SupportedAgent, shellHookPath: string): string {
  const definition = agentDefinition(agent);
  return `${definition.profileBlockStart}\n[ -f ${shellQuote(shellHookPath)} ] && source ${shellQuote(shellHookPath)}\n${definition.profileBlockEnd}`;
}

function stripProfileSourceBlock(contents: string, agent: SupportedAgent): string {
  const definition = agentDefinition(agent);
  const blockPattern = new RegExp(`${escapeRegExp(definition.profileBlockStart)}[\\s\\S]*?${escapeRegExp(definition.profileBlockEnd)}\\n?`, "g");
  return contents.replace(blockPattern, "");
}

async function upsertProfileSourceBlock(agent: SupportedAgent, profilePath: string, shellHookPath: string): Promise<void> {
  const nextBlock = profileSourceBlock(agent, shellHookPath);
  const existing = (await pathExists(profilePath)) ? await readFile(profilePath, "utf8") : "";
  const stripped = stripProfileSourceBlock(existing, agent).trimEnd();
  const nextContents = stripped.length > 0 ? `${stripped}\n\n${nextBlock}\n` : `${nextBlock}\n`;
  await mkdir(path.dirname(profilePath), { recursive: true });
  await writeFile(profilePath, nextContents, "utf8");
}

async function removeProfileSourceBlock(agent: SupportedAgent, profilePath: string): Promise<void> {
  if (!(await pathExists(profilePath))) {
    return;
  }

  const existing = await readFile(profilePath, "utf8");
  const stripped = stripProfileSourceBlock(existing, agent).trimEnd();
  await writeFile(profilePath, stripped.length > 0 ? `${stripped}\n` : "", "utf8");
}

async function installShellHook(
  agent: SupportedAgent,
  paths: AgentIntegrationPaths,
  shellProfilePath: string,
  realBinaryPath: string,
): Promise<void> {
  await ensureIntegrationDirectories(paths);
  await writeFile(paths.shellHookPath, shellHookContents(agent, paths), "utf8");
  await writeFile(paths.realBinaryPathFile, `${realBinaryPath}\n`, "utf8");
  await writeFile(paths.shellProfilePathFile, `${shellProfilePath}\n`, "utf8");
  await upsertProfileSourceBlock(agent, shellProfilePath, paths.shellHookPath);
}

export async function installAgentShellHook(
  agent: SupportedAgent,
  options: AgentIntegrationOptions = {},
): Promise<AgentShellInstallResult> {
  const paths = resolveIntegrationPaths(agent, options);
  const shellProfilePath = options.shellProfilePath ?? await readStoredShellProfilePath(paths) ?? defaultShellProfilePath();
  const realBinaryPath = await resolveRealBinaryPath(agent, paths, options);
  const storedRealBinaryPath = await readStoredRealBinaryPath(paths);
  const shellHookInstalled = await pathExists(paths.shellHookPath);
  const shellProfileConfigured = await profileHasSourceBlock(agent, shellProfilePath);
  const shellHookUpdated = !shellHookInstalled || !shellProfileConfigured || storedRealBinaryPath !== realBinaryPath;

  await installShellHook(agent, paths, shellProfilePath, realBinaryPath);

  return {
    agent,
    shellHookPath: paths.shellHookPath,
    shellProfilePath,
    realBinaryPath,
    shellHookUpdated,
  };
}

async function currentRepoMarker(agent: SupportedAgent, startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const markerPath = integrationMarkerPath(agent, currentDir);
    if (await pathExists(markerPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

export async function discoverProjectRoot(startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (await pathExists(path.join(currentDir, ".secureskills"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function spawnPassthrough(agent: SupportedAgent, command: string[], cwd: string): Promise<number> {
  const definition = agentDefinition(agent);

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        [definition.bypassEnvVar]: "1",
      },
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function enableAgentForRepo(
  agent: SupportedAgent,
  repoRoot: string,
  options: AgentIntegrationOptions = {},
): Promise<AgentEnableResult> {
  const { project, initializedProject } = await ensureProject(repoRoot);
  const shellInstall = await installAgentShellHook(agent, options);
  await writeJsonFile(integrationMarkerPath(agent, project.rootDir), {
    version: 1,
    enabledAt: new Date().toISOString(),
  } satisfies AgentIntegrationMarker);

  return {
    agent,
    repoRoot: project.rootDir,
    initializedProject,
    shellHookPath: shellInstall.shellHookPath,
    shellProfilePath: shellInstall.shellProfilePath,
    realBinaryPath: shellInstall.realBinaryPath,
    shellHookUpdated: shellInstall.shellHookUpdated,
  };
}

export async function disableAgentForRepo(agent: SupportedAgent, repoRoot: string): Promise<AgentDisableResult> {
  const markerPath = integrationMarkerPath(agent, repoRoot);
  const disabled = await pathExists(markerPath);
  await removeIfExists(markerPath);
  return {
    agent,
    repoRoot,
    disabled,
  };
}

export async function doctorAgent(
  agent: SupportedAgent,
  startDir: string,
  options: AgentIntegrationOptions = {},
): Promise<AgentDoctorReport> {
  const paths = resolveIntegrationPaths(agent, options);
  const shellProfilePath = options.shellProfilePath ?? await readStoredShellProfilePath(paths) ?? defaultShellProfilePath();
  const shellHookInstalled = await pathExists(paths.shellHookPath);
  const shellProfileConfigured = await profileHasSourceBlock(agent, shellProfilePath);
  const realBinaryPath = await readStoredRealBinaryPath(paths);
  const realBinaryPathUsable = await fileIsExecutable(realBinaryPath);
  const repoRoot = await currentRepoMarker(agent, startDir);
  const definition = agentDefinition(agent);
  const issues: string[] = [];

  if (!shellHookInstalled) {
    issues.push(`Missing shell hook: ${paths.shellHookPath}`);
  }
  if (!shellProfileConfigured) {
    issues.push(`Shell profile is missing the Plato source block: ${shellProfilePath}`);
  }
  if (!realBinaryPathUsable) {
    issues.push(`Real ${definition.binaryName} path is missing or not executable: ${paths.realBinaryPathFile}`);
  }

  return {
    agent,
    repoRoot,
    repoEnabled: repoRoot !== null,
    shellHookPath: paths.shellHookPath,
    shellHookInstalled,
    shellProfilePath,
    shellProfileConfigured,
    realBinaryPathFile: paths.realBinaryPathFile,
    realBinaryPath,
    realBinaryPathUsable,
    issues,
  };
}

async function profileHasSourceBlock(agent: SupportedAgent, profilePath: string): Promise<boolean> {
  if (!(await pathExists(profilePath))) {
    return false;
  }

  const definition = agentDefinition(agent);
  const contents = await readFile(profilePath, "utf8");
  return contents.includes(definition.profileBlockStart) && contents.includes(definition.profileBlockEnd);
}

export async function launchAgent(
  agent: SupportedAgent,
  commandArguments: string[],
  startDir: string,
  options: AgentIntegrationOptions = {},
): Promise<number> {
  const paths = resolveIntegrationPaths(agent, options);
  const realBinaryPath = await resolveRealBinaryPath(agent, paths, options);
  const repoRoot = await currentRepoMarker(agent, startDir);
  const definition = agentDefinition(agent);

  if (!repoRoot) {
    return spawnPassthrough(agent, [realBinaryPath, ...commandArguments], startDir);
  }

  return runAgentCommand(repoRoot, [realBinaryPath, ...commandArguments], {
    launchFromDir: startDir,
    env: {
      ...process.env,
      [definition.bypassEnvVar]: "1",
    },
  });
}

export async function cleanupAllAgentShellIntegrations(options: AgentIntegrationOptions = {}): Promise<void> {
  const platoHomeDir = options.platoHomeDir ?? defaultPlatoHomeDir();
  const profilePaths = new Set<string>();

  if (options.shellProfilePath) {
    profilePaths.add(options.shellProfilePath);
  }

  for (const agent of SUPPORTED_AGENTS) {
    const paths = resolveIntegrationPaths(agent, { platoHomeDir });
    const storedProfilePath = await readStoredShellProfilePath(paths);
    if (storedProfilePath) {
      profilePaths.add(storedProfilePath);
    }
  }

  if (profilePaths.size === 0) {
    profilePaths.add(defaultShellProfilePath());
  }

  for (const profilePath of profilePaths) {
    for (const agent of SUPPORTED_AGENTS) {
      await removeProfileSourceBlock(agent, profilePath);
    }
  }

  await rm(platoHomeDir, { recursive: true, force: true });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
