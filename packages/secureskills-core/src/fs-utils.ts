import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(targetPath: string): Promise<T> {
  const contents = await readFile(targetPath, "utf8");
  return JSON.parse(contents) as T;
}

export async function writeJsonFile(targetPath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(currentDir: string, relativeDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlinked content is not allowed in secured skills: ${path.join(relativeDir, entry.name)}`);
      }

      const entryAbsolutePath = path.join(currentDir, entry.name);
      const entryRelativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await visit(entryAbsolutePath, entryRelativePath);
        continue;
      }

      if (entry.isFile()) {
        files.push(entryRelativePath);
      }
    }
  }

  await visit(rootDir, "");
  return files;
}

export async function removeIfExists(targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    await rm(targetPath, { recursive: true, force: true });
  }
}

export async function writeTextFile(targetPath: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await writeFile(targetPath, contents, "utf8");
}

export async function symlinkAbsoluteTarget(targetPath: string, linkPath: string): Promise<void> {
  await ensureDir(path.dirname(linkPath));
  await symlink(targetPath, linkPath);
}
