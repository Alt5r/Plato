import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { SKILL_MARKER_FILE } from "./constants.ts";
import { pathExists } from "./fs-utils.ts";

interface ResolvedSource {
  type: "local" | "git";
  ref: string;
  resolvedRef: string | null;
  commitSha: string | null;
  directory: string;
  cleanup: () => Promise<void>;
}

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".secureskills"]);

function looksLikeGitSource(sourceRef: string): boolean {
  return (
    sourceRef.startsWith("http://") ||
    sourceRef.startsWith("https://") ||
    sourceRef.startsWith("file://") ||
    sourceRef.startsWith("ssh://") ||
    sourceRef.startsWith("git+https://") ||
    sourceRef.startsWith("git@") ||
    sourceRef.endsWith(".git") ||
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(sourceRef)
  );
}

function normalizeGitSource(sourceRef: string): string {
  if (sourceRef.startsWith("git+https://")) {
    return sourceRef.slice("git+".length);
  }

  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(sourceRef)) {
    return `https://github.com/${sourceRef}.git`;
  }

  return sourceRef;
}

async function runGitClone(sourceRef: string, targetDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", normalizeGitSource(sourceRef), targetDir], {
      stdio: "pipe",
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `git clone failed for ${sourceRef}`));
    });
  });
}

async function runGitCommand(args: string[], workdir: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: workdir,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
    });
  });
}

export async function resolveSource(rootDir: string, sourceRef: string): Promise<ResolvedSource> {
  const localPath = path.resolve(rootDir, sourceRef);
  if (await pathExists(localPath) && (await stat(localPath)).isDirectory()) {
    return {
      type: "local",
      ref: sourceRef,
      resolvedRef: null,
      commitSha: null,
      directory: localPath,
      cleanup: async () => {},
    };
  }

  if (!looksLikeGitSource(sourceRef)) {
    throw new Error(`Unsupported source: ${sourceRef}`);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "secureskills-source-"));
  await runGitClone(sourceRef, tempDir);
  const commitSha = await runGitCommand(["rev-parse", "HEAD"], tempDir);
  return {
    type: "git",
    ref: sourceRef,
    resolvedRef: commitSha,
    commitSha,
    directory: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function findSkillDirectory(sourceRoot: string, skillName: string): Promise<string | null> {
  const rootMarker = path.join(sourceRoot, SKILL_MARKER_FILE);
  if (path.basename(sourceRoot) === skillName && (await pathExists(rootMarker))) {
    return sourceRoot;
  }

  const entries = await readdir(sourceRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const childDirectory = path.join(sourceRoot, entry.name);
    const childMarker = path.join(childDirectory, SKILL_MARKER_FILE);
    if (entry.name === skillName && (await pathExists(childMarker))) {
      return childDirectory;
    }

    const nestedMatch = await findSkillDirectory(childDirectory, skillName);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}
