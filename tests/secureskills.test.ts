import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import {
  doctorAgent,
  disableAgentForRepo,
  enableAgentForRepo,
  installAgentShellHook,
  launchAgent,
} from "../packages/secureskills-cli/src/codex-integration.ts";
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
    const expectedCommit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRepoDir,
      encoding: "utf8",
    }).stdout.trim();

    assert.equal(result.sourceType, "git");
    assert.equal(result.initializedProject, true);
    assert.equal(inspection.manifest.source.type, "git");
    assert.equal(inspection.manifest.source.ref, `file://${sourceRepoDir}`);
    assert.equal(result.sourceCommitSha, expectedCommit);
    assert.equal(result.resolvedSourceRef, expectedCommit);
    assert.equal(inspection.manifest.source.commitSha, expectedCommit);
    assert.equal(inspection.manifest.source.resolvedRef, expectedCommit);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(sourceRepoDir, { recursive: true, force: true });
  }
});

test("add rejects invalid skill names before initializing the project", async () => {
  const projectDir = await createTempProject();

  try {
    await assert.rejects(
      addSkill(projectDir, fixtureSource, "../rogue"),
      /Invalid skill name/,
    );
    await assert.rejects(stat(path.join(projectDir, ".secureskills")));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
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

test("setupProject writes key material with restricted permissions", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX permission modes are not stable on Windows");
    return;
  }

  const projectDir = await createTempProject();

  try {
    await setupProject(projectDir);

    const keysDirPath = path.join(projectDir, ".secureskills", "keys");
    const keysDirStats = await stat(keysDirPath);
    const privateKeyStats = await stat(path.join(keysDirPath, "signing.private.pem"));
    const publicKeyStats = await stat(path.join(keysDirPath, "signing.public.pem"));
    const masterKeyStats = await stat(path.join(keysDirPath, "master.key"));

    assert.equal(keysDirStats.mode & 0o777, 0o700);
    assert.equal(privateKeyStats.mode & 0o777, 0o600);
    assert.equal(publicKeyStats.mode & 0o777, 0o600);
    assert.equal(masterKeyStats.mode & 0o777, 0o600);
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

test("runAgentCommand refuses to mirror unexpected workspace symlinks into the project", async () => {
  const projectDir = await createTempProject();
  const launchDir = path.join(projectDir, "src");
  const mirroredSymlink = path.join(launchDir, "escape-link");

  try {
    await mkdir(launchDir, { recursive: true });
    await setupProject(projectDir);
    await addSkill(projectDir, fixtureSource, "find-skills");

    await assert.rejects(
      runAgentCommand(
        projectDir,
        [
          "node",
          "-e",
          "require('node:fs').symlinkSync('/tmp', 'escape-link')",
        ],
        { launchFromDir: launchDir },
      ),
      /Refusing to mirror workspace symlink/,
    );

    await assert.rejects(lstat(mirroredSymlink));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("enable codex installs the shell hook and marks the repo enabled", async () => {
  const projectDir = await createTempProject();
  const homeDir = await mkdtemp(path.join(tmpdir(), "plato-home-"));
  const platoHomeDir = path.join(homeDir, ".config", "plato");
  const shellProfilePath = path.join(homeDir, ".zshrc");
  const fakeCodexPath = path.join(homeDir, "codex");

  try {
    await writeFile(
      fakeCodexPath,
      "#!/usr/bin/env bash\nexit 0\n",
      "utf8",
    );
    await chmod(fakeCodexPath, 0o755);

    const result = await enableAgentForRepo("codex", projectDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeCodexPath,
    });
    const doctor = await doctorAgent("codex", projectDir, {
      platoHomeDir,
      shellProfilePath,
    });
    const shellProfile = await readFile(shellProfilePath, "utf8");

    assert.equal(result.initializedProject, true);
    await assert.doesNotReject(stat(path.join(projectDir, ".secureskills", "integrations", "codex.json")));
    await assert.doesNotReject(stat(path.join(platoHomeDir, "shell", "codex.zsh")));
    assert.match(shellProfile, /Plato Codex integration/);
    assert.equal(doctor.repoEnabled, true);
    assert.equal(doctor.shellHookInstalled, true);
    assert.equal(doctor.shellProfileConfigured, true);
    assert.equal(doctor.realBinaryPathUsable, true);
    assert.deepEqual(doctor.issues, []);

    const disableResult = await disableAgentForRepo("codex", projectDir);
    assert.equal(disableResult.disabled, true);
    await assert.rejects(stat(path.join(projectDir, ".secureskills", "integrations", "codex.json")));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("enable codex reuses a preinstalled shell hook without another update", async () => {
  const projectDir = await createTempProject();
  const homeDir = await mkdtemp(path.join(tmpdir(), "plato-preinstalled-home-"));
  const platoHomeDir = path.join(homeDir, ".config", "plato");
  const shellProfilePath = path.join(homeDir, ".zshrc");
  const fakeCodexPath = path.join(homeDir, "codex");

  try {
    await writeFile(fakeCodexPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeCodexPath, 0o755);

    const firstInstall = await installAgentShellHook("codex", {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeCodexPath,
    });
    const secondInstall = await installAgentShellHook("codex", {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeCodexPath,
    });
    const enableResult = await enableAgentForRepo("codex", projectDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeCodexPath,
    });

    assert.equal(firstInstall.shellHookUpdated, true);
    assert.equal(secondInstall.shellHookUpdated, false);
    assert.equal(enableResult.shellHookUpdated, false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("launch codex uses the verified workspace and preserves the subdirectory", async () => {
  const projectDir = await createTempProject();
  const homeDir = await mkdtemp(path.join(tmpdir(), "plato-launch-home-"));
  const platoHomeDir = path.join(homeDir, ".config", "plato");
  const shellProfilePath = path.join(homeDir, ".zshrc");
  const fakeCodexPath = path.join(homeDir, "codex");
  const launchDir = path.join(projectDir, "src");
  const resultFile = path.join(homeDir, "launch-result.txt");
  const createdFilePath = path.join(launchDir, "index.html");
  const deletedFilePath = path.join(launchDir, "remove-me.txt");
  const modifiedFilePath = path.join(launchDir, "update-me.txt");
  const readyFilePath = path.join(homeDir, "codex-ready");
  const releaseFilePath = path.join(homeDir, "codex-release");

  try {
    await mkdir(launchDir, { recursive: true });
    await setupProject(projectDir);
    await addSkill(projectDir, fixtureSource, "find-skills");
    await writeFile(deletedFilePath, "remove this file\n", "utf8");
    await writeFile(modifiedFilePath, "before codex update\n", "utf8");
    await mkdir(path.join(projectDir, ".agents", "skills", "rogue"), { recursive: true });
    await writeFile(path.join(projectDir, ".agents", "skills", "rogue", "SKILL.md"), "rogue\n", "utf8");
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env bash
set -euo pipefail
RESULT_FILE="$1"
READY_FILE="$2"
RELEASE_FILE="$3"
find_skill() {
  local skill_name="$1"
  local current_dir="$PWD"
  while true; do
    if [ -f "$current_dir/.agents/skills/$skill_name/SKILL.md" ]; then
      return 0
    fi
    local parent_dir
    parent_dir="$(dirname "$current_dir")"
    if [ "$parent_dir" = "$current_dir" ]; then
      return 1
    fi
    current_dir="$parent_dir"
  done
}
{
  printf 'cwd=%s\n' "$PWD"
  if find_skill "find-skills"; then printf 'find-skills=true\n'; else printf 'find-skills=false\n'; fi
  if find_skill "rogue"; then printf 'rogue=true\n'; else printf 'rogue=false\n'; fi
} > "$RESULT_FILE"
cat > index.html <<'EOF'
<!DOCTYPE html>
<html>
  <body>generated by codex launcher test</body>
</html>
EOF
printf 'after codex update\n' > update-me.txt
rm remove-me.txt
touch "$READY_FILE"
while [ ! -f "$RELEASE_FILE" ]; do
  sleep 0.05
done
`,
      "utf8",
    );
    await chmod(fakeCodexPath, 0o755);

    await enableAgentForRepo("codex", projectDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeCodexPath,
    });

    const launchPromise = launchAgent("codex", [resultFile, readyFilePath, releaseFilePath], launchDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeCodexPath,
    });
    await waitForPath(readyFilePath);
    const liveCreatedFile = await waitForFileContents(createdFilePath, /generated by codex launcher test/);
    const liveModifiedFile = await waitForFileContents(modifiedFilePath, /after codex update/);
    assert.match(liveCreatedFile, /generated by codex launcher test/);
    assert.match(liveModifiedFile, /after codex update/);
    await waitForMissingPath(deletedFilePath);

    await writeFile(releaseFilePath, "release\n", "utf8");
    const exitCode = await launchPromise;
    const launchOutput = await readFile(resultFile, "utf8");
    const createdFile = await readFile(createdFilePath, "utf8");
    const modifiedFile = await readFile(modifiedFilePath, "utf8");

    assert.equal(exitCode, 0);
    assert.match(launchOutput, /cwd=.*\/src/);
    assert.match(launchOutput, /find-skills=true/);
    assert.match(launchOutput, /rogue=false/);
    assert.match(createdFile, /generated by codex launcher test/);
    assert.match(modifiedFile, /after codex update/);
    await assert.rejects(stat(deletedFilePath));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("enable claude installs the shell hook and marks the repo enabled", async () => {
  const projectDir = await createTempProject();
  const homeDir = await mkdtemp(path.join(tmpdir(), "plato-claude-home-"));
  const platoHomeDir = path.join(homeDir, ".config", "plato");
  const shellProfilePath = path.join(homeDir, ".zshrc");
  const fakeClaudePath = path.join(homeDir, "claude");

  try {
    await writeFile(
      fakeClaudePath,
      "#!/usr/bin/env bash\nexit 0\n",
      "utf8",
    );
    await chmod(fakeClaudePath, 0o755);

    const result = await enableAgentForRepo("claude", projectDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeClaudePath,
    });
    const doctor = await doctorAgent("claude", projectDir, {
      platoHomeDir,
      shellProfilePath,
    });
    const shellProfile = await readFile(shellProfilePath, "utf8");

    assert.equal(result.initializedProject, true);
    await assert.doesNotReject(stat(path.join(projectDir, ".secureskills", "integrations", "claude.json")));
    await assert.doesNotReject(stat(path.join(platoHomeDir, "shell", "claude.zsh")));
    assert.match(shellProfile, /Plato Claude integration/);
    assert.equal(doctor.repoEnabled, true);
    assert.equal(doctor.shellHookInstalled, true);
    assert.equal(doctor.shellProfileConfigured, true);
    assert.equal(doctor.realBinaryPathUsable, true);
    assert.deepEqual(doctor.issues, []);

    const disableResult = await disableAgentForRepo("claude", projectDir);
    assert.equal(disableResult.disabled, true);
    await assert.rejects(stat(path.join(projectDir, ".secureskills", "integrations", "claude.json")));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("launch claude uses the verified workspace and preserves the subdirectory", async () => {
  const projectDir = await createTempProject();
  const homeDir = await mkdtemp(path.join(tmpdir(), "plato-claude-launch-home-"));
  const platoHomeDir = path.join(homeDir, ".config", "plato");
  const shellProfilePath = path.join(homeDir, ".zshrc");
  const fakeClaudePath = path.join(homeDir, "claude");
  const launchDir = path.join(projectDir, "src");
  const resultFile = path.join(homeDir, "claude-launch-result.txt");
  const createdFilePath = path.join(launchDir, "claude-index.html");
  const modifiedFilePath = path.join(launchDir, "claude-update.txt");
  const deletedFilePath = path.join(launchDir, "claude-remove.txt");
  const readyFilePath = path.join(homeDir, "claude-ready");
  const releaseFilePath = path.join(homeDir, "claude-release");

  try {
    await mkdir(launchDir, { recursive: true });
    await setupProject(projectDir);
    await addSkill(projectDir, fixtureSource, "find-skills");
    await writeFile(modifiedFilePath, "before claude update\n", "utf8");
    await writeFile(deletedFilePath, "delete me\n", "utf8");
    await mkdir(path.join(projectDir, ".agents", "skills", "rogue"), { recursive: true });
    await writeFile(path.join(projectDir, ".agents", "skills", "rogue", "SKILL.md"), "rogue\n", "utf8");
    await writeFile(
      fakeClaudePath,
      `#!/usr/bin/env bash
set -euo pipefail
RESULT_FILE="$1"
READY_FILE="$2"
RELEASE_FILE="$3"
find_skill() {
  local skill_name="$1"
  local current_dir="$PWD"
  while true; do
    if [ -f "$current_dir/.agents/skills/$skill_name/SKILL.md" ]; then
      return 0
    fi
    local parent_dir
    parent_dir="$(dirname "$current_dir")"
    if [ "$parent_dir" = "$current_dir" ]; then
      return 1
    fi
    current_dir="$parent_dir"
  done
}
{
  printf 'cwd=%s\n' "$PWD"
  if find_skill "find-skills"; then printf 'find-skills=true\n'; else printf 'find-skills=false\n'; fi
  if find_skill "rogue"; then printf 'rogue=true\n'; else printf 'rogue=false\n'; fi
} > "$RESULT_FILE"
cat > claude-index.html <<'EOF'
<!DOCTYPE html>
<html>
  <body>generated by claude launcher test</body>
</html>
EOF
printf 'after claude update\n' > claude-update.txt
rm claude-remove.txt
touch "$READY_FILE"
while [ ! -f "$RELEASE_FILE" ]; do
  sleep 0.05
done
`,
      "utf8",
    );
    await chmod(fakeClaudePath, 0o755);

    await enableAgentForRepo("claude", projectDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeClaudePath,
    });

    const launchPromise = launchAgent("claude", [resultFile, readyFilePath, releaseFilePath], launchDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeClaudePath,
    });
    await waitForPath(readyFilePath);
    const liveCreatedFile = await waitForFileContents(createdFilePath, /generated by claude launcher test/);
    const liveModifiedFile = await waitForFileContents(modifiedFilePath, /after claude update/);
    assert.match(liveCreatedFile, /generated by claude launcher test/);
    assert.match(liveModifiedFile, /after claude update/);
    await waitForMissingPath(deletedFilePath);

    await writeFile(releaseFilePath, "release\n", "utf8");
    const exitCode = await launchPromise;
    const launchOutput = await readFile(resultFile, "utf8");
    const createdFile = await readFile(createdFilePath, "utf8");
    const modifiedFile = await readFile(modifiedFilePath, "utf8");

    assert.equal(exitCode, 0);
    assert.match(launchOutput, /cwd=.*\/src/);
    assert.match(launchOutput, /find-skills=true/);
    assert.match(launchOutput, /rogue=false/);
    assert.match(createdFile, /generated by claude launcher test/);
    assert.match(modifiedFile, /after claude update/);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("uninstall removes the managed install directory and Codex shell integration after npm uninstall succeeds", async () => {
  const installDir = await mkdtemp(path.join(tmpdir(), "plato-install-dir-"));
  const fakeBinDir = await mkdtemp(path.join(tmpdir(), "plato-fake-bin-"));
  const fakeNpmPath = path.join(fakeBinDir, "npm");
  const logPath = path.join(fakeBinDir, "npm.log");
  const homeDir = await mkdtemp(path.join(tmpdir(), "plato-uninstall-home-"));
  const platoHomeDir = path.join(homeDir, ".config", "plato");
  const shellProfilePath = path.join(homeDir, ".zshrc");
  const fakeCodexPath = path.join(homeDir, "codex");
  const fakeClaudePath = path.join(homeDir, "claude");
  const projectDir = await createTempProject();

  try {
    await writeFile(path.join(installDir, "marker.txt"), "installed\n", "utf8");
    await writeFile(fakeCodexPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeCodexPath, 0o755);
    await writeFile(fakeClaudePath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeClaudePath, 0o755);
    await enableAgentForRepo("codex", projectDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeCodexPath,
    });
    await enableAgentForRepo("claude", projectDir, {
      platoHomeDir,
      shellProfilePath,
      realBinaryPath: fakeClaudePath,
    });
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
      platoHomeDir,
      shellProfilePath,
    });

    const loggedArgs = await readFile(logPath, "utf8");
    const shellProfile = await readFile(shellProfilePath, "utf8");
    assert.equal(result.installDir, installDir);
    assert.match(loggedArgs, /^uninstall -g secureskills/);
    await assert.rejects(stat(installDir));
    await assert.rejects(stat(platoHomeDir));
    assert.doesNotMatch(shellProfile, /Plato Codex integration/);
    assert.doesNotMatch(shellProfile, /Plato Claude integration/);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(installDir, { recursive: true, force: true });
    await rm(fakeBinDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("install.sh resolves stable through release channels and records install metadata", async () => {
  const installDir = await mkdtemp(path.join(tmpdir(), "plato-install-script-dir-"));
  const fakeRepoDir = await mkdtemp(path.join(tmpdir(), "plato-install-script-repo-"));
  const fakeBinDir = await mkdtemp(path.join(tmpdir(), "plato-install-script-bin-"));
  const fakeNpmPath = path.join(fakeBinDir, "npm");
  const scriptPath = path.join(repoRoot, "scripts", "install.sh");

  try {
    runGit(["init", "-b", "main"], fakeRepoDir);
    runGit(["config", "user.name", "PlaTo Test"], fakeRepoDir);
    runGit(["config", "user.email", "test@example.com"], fakeRepoDir);
    await writeFile(path.join(fakeRepoDir, "package.json"), '{\"name\":\"secureskills\"}\n', "utf8");
    await writeFile(path.join(fakeRepoDir, "release-channels.json"), JSON.stringify({
      stable: "v1.2.3",
      latest: "main",
      experimental: "experimental",
    }, null, 2), "utf8");
    await mkdir(path.join(fakeRepoDir, "bin"), { recursive: true });
    await writeFile(path.join(fakeRepoDir, "bin", "secureskills.js"), "#!/usr/bin/env node\nprocess.exit(0)\n", "utf8");
    runGit(["add", "."], fakeRepoDir);
    runGit(["commit", "-m", "initial"], fakeRepoDir);
    runGit(["tag", "v1.2.3"], fakeRepoDir);

    await writeFile(
      fakeNpmPath,
      "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n",
      "utf8",
    );
    await chmod(fakeNpmPath, 0o755);

    const result = spawnSync(
      "bash",
      [scriptPath, "stable"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
          PLATO_REPO_URL: fakeRepoDir,
          PLATO_INSTALL_DIR: installDir,
          PLATO_DEFAULT_AGENT: "skip",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const metadata = JSON.parse(await readFile(path.join(installDir, ".plato-install.json"), "utf8")) as {
      requestedTarget: string;
      resolvedRef: string;
      commitSha: string;
    };
    const installedCommit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: installDir,
      encoding: "utf8",
    }).stdout.trim();

    assert.equal(metadata.requestedTarget, "stable");
    assert.equal(metadata.resolvedRef, "v1.2.3");
    assert.equal(metadata.commitSha, installedCommit);
    assert.match(result.stdout, /installed PlaTo stable -> v1\.2\.3/);
  } finally {
    await rm(installDir, { recursive: true, force: true });
    await rm(fakeRepoDir, { recursive: true, force: true });
    await rm(fakeBinDir, { recursive: true, force: true });
  }
});

test("install.sh rejects invalid install targets", async () => {
  const installDir = await mkdtemp(path.join(tmpdir(), "plato-install-invalid-dir-"));
  const scriptPath = path.join(repoRoot, "scripts", "install.sh");

  try {
    const result = spawnSync(
      "bash",
      [scriptPath, "not-a-channel"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PLATO_INSTALL_DIR: installDir,
          PLATO_DEFAULT_AGENT: "skip",
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid install target/);
  } finally {
    await rm(installDir, { recursive: true, force: true });
  }
});

async function waitForPath(targetPath: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await stat(targetPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  throw new Error(`Timed out waiting for ${targetPath}`);
}

async function waitForMissingPath(targetPath: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await stat(targetPath);
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${targetPath} to disappear`);
}

async function waitForFileContents(targetPath: string, pattern: RegExp, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const contents = await readFile(targetPath, "utf8");
      if (pattern.test(contents)) {
        return contents;
      }
    } catch {
      // Wait for the file to appear or update.
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${targetPath} to match ${pattern}`);
}
