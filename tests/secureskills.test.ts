import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  addSkill,
  createVerifiedWorkspace,
  inspectSkill,
  runAgentCommand,
  setupProject,
  verifyProject,
} from "../packages/secureskills-core/src/index.ts";
import { uninstallPlaTo } from "../packages/secureskills-cli/src/uninstall.ts";

const repoRoot = process.cwd();
const fixtureSource = path.join(repoRoot, "fixtures", "sources", "mock-skills");

async function createTempProject(): Promise<string> {
  const projectDir = await mkdtemp(path.join(tmpdir(), "secureskills-test-"));
  await mkdir(projectDir, { recursive: true });
  return projectDir;
}

function runGit(args: string[], workdir: string): void {
  const result = spawnSync("git", args, {
    cwd: workdir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}

test("add auto-initializes the project and verifies a plaintext skill", async () => {
  const projectDir = await createTempProject();

  try {
    const result = await addSkill(projectDir, fixtureSource, "find-skills");
    const report = await verifyProject(projectDir);
    const inspection = await inspectSkill(projectDir, "find-skills");
    const storedSkill = await readFile(
      path.join(projectDir, ".secureskills", "store", "find-skills", "payload", "SKILL.md"),
      "utf8",
    );

    assert.equal(result.encrypted, false);
    assert.equal(result.initializedProject, true);
    assert.equal(report.ok, true);
    assert.equal(report.bundles.length, 1);
    assert.equal(inspection.verified, true);
    assert.equal(inspection.manifest.files.length, 2);
    assert.match(storedSkill, /plaintext fixture skill/);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("add can pull a skill through the git clone path", async () => {
  const projectDir = await createTempProject();
  const sourceRepoDir = await mkdtemp(path.join(tmpdir(), "secureskills-git-source-"));

  try {
    runGit(["init", "-b", "main"], sourceRepoDir);
    runGit(["config", "user.name", "SecureSkills Test"], sourceRepoDir);
    runGit(["config", "user.email", "test@example.com"], sourceRepoDir);
    runGit(["remote", "add", "origin", "https://github.com/example/skills.git"], sourceRepoDir);
    await mkdir(path.join(sourceRepoDir, "find-skills"), { recursive: true });
    await writeFile(
      path.join(sourceRepoDir, "find-skills", "SKILL.md"),
      "---\nname: find-skills\n---\n",
      "utf8",
    );
    await writeFile(path.join(sourceRepoDir, "find-skills", "notes.txt"), "git fixture\n", "utf8");
    runGit(["add", "."], sourceRepoDir);
    runGit(["commit", "-m", "fixture"], sourceRepoDir);

    const result = await addSkill(projectDir, `file://${sourceRepoDir}`, "find-skills");
    const inspection = await inspectSkill(projectDir, "find-skills");

    assert.equal(result.sourceType, "git");
    assert.equal(result.initializedProject, true);
    assert.equal(inspection.manifest.source.type, "git");
    assert.equal(inspection.manifest.source.ref, `file://${sourceRepoDir}`);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(sourceRepoDir, { recursive: true, force: true });
  }
});

test("tampering with a stored plaintext payload fails verification", async () => {
  const projectDir = await createTempProject();

  try {
    await setupProject(projectDir);
    await addSkill(projectDir, fixtureSource, "find-skills");
    await writeFile(
      path.join(projectDir, ".secureskills", "store", "find-skills", "payload", "SKILL.md"),
      "tampered",
      "utf8",
    );

    const report = await verifyProject(projectDir);
    assert.equal(report.ok, false);
    assert.match(report.bundles[0].errors.join("\n"), /Stored digest mismatch/);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("encrypted installs stay opaque on disk and still verify", async () => {
  const projectDir = await createTempProject();

  try {
    await setupProject(projectDir);
    await addSkill(projectDir, fixtureSource, "find-skills", { encrypt: true });

    const report = await verifyProject(projectDir);
    const inspection = await inspectSkill(projectDir, "find-skills");
    const storedBytes = await readFile(
      path.join(projectDir, ".secureskills", "store", "find-skills", "payload", "SKILL.md"),
    );

    assert.equal(report.ok, true);
    assert.equal(inspection.manifest.encryption.enabled, true);
    assert.equal(storedBytes.includes(Buffer.from("plaintext fixture skill")), false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("verified workspace exposes only authorized skills and cleans up", async () => {
  const projectDir = await createTempProject();

  try {
    await setupProject(projectDir);
    await addSkill(projectDir, fixtureSource, "find-skills", { encrypt: true });

    await mkdir(path.join(projectDir, ".agents", "skills", "rogue"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".agents", "skills", "rogue", "SKILL.md"),
      "rogue skill",
      "utf8",
    );

    const workspace = await createVerifiedWorkspace(projectDir);
    const materializedSkill = await readFile(
      path.join(workspace.runtimeSkillsDir, "find-skills", "SKILL.md"),
      "utf8",
    );

    assert.match(materializedSkill, /plaintext fixture skill/);
    await assert.doesNotReject(stat(path.join(workspace.workspaceDir, ".agents", "skills", "find-skills", "SKILL.md")));
    await assert.rejects(stat(path.join(workspace.workspaceDir, ".agents", "skills", "rogue", "SKILL.md")));

    const exitCode = await runAgentCommand(projectDir, [
      "node",
      "-e",
      "const fs = require('node:fs'); process.exit(fs.existsSync('.agents/skills/find-skills/SKILL.md') && !fs.existsSync('.agents/skills/rogue/SKILL.md') ? 0 : 2);",
    ]);

    assert.equal(exitCode, 0);
    const workspacePath = workspace.workspaceDir;
    await workspace.cleanup();
    await assert.rejects(stat(workspacePath));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("uninstall removes the managed install directory after npm uninstall succeeds", async () => {
  const installDir = await mkdtemp(path.join(tmpdir(), "plato-install-dir-"));
  const fakeBinDir = await mkdtemp(path.join(tmpdir(), "plato-fake-bin-"));
  const fakeNpmPath = path.join(fakeBinDir, "npm");
  const logPath = path.join(fakeBinDir, "npm.log");

  try {
    await writeFile(path.join(installDir, "marker.txt"), "installed\n", "utf8");
    await writeFile(
      fakeNpmPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" > "${logPath}"
`,
      "utf8",
    );
    await chmod(fakeNpmPath, 0o755);

    const result = await uninstallPlaTo({
      installDir,
      npmCommand: fakeNpmPath,
    });

    const loggedArgs = await readFile(logPath, "utf8");
    assert.equal(result.installDir, installDir);
    assert.match(loggedArgs, /^uninstall -g secureskills/);
    await assert.rejects(stat(installDir));
  } finally {
    await rm(installDir, { recursive: true, force: true });
    await rm(fakeBinDir, { recursive: true, force: true });
  }
});
