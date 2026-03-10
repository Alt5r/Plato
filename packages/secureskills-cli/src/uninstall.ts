import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface UninstallOptions {
  installDir?: string;
  npmCommand?: string;
  packageName?: string;
}

export interface UninstallResult {
  installDir: string;
  packageName: string;
}

export function defaultInstallDir(): string {
  return process.env.PLATO_INSTALL_DIR ?? path.join(homedir(), ".local", "share", "plato");
}

export async function uninstallPlaTo(options: UninstallOptions = {}): Promise<UninstallResult> {
  const installDir = options.installDir ?? defaultInstallDir();
  const npmCommand = options.npmCommand ?? "npm";
  const packageName = options.packageName ?? "secureskills";

  const result = spawnSync(npmCommand, ["uninstall", "-g", packageName], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`npm uninstall failed with exit code ${result.status ?? 1}`);
  }

  await rm(installDir, { recursive: true, force: true });

  return {
    installDir,
    packageName,
  };
}
