#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import {
  addSkill,
  inspectSkill,
  runAgentCommand,
  setupProject,
  verifyProject,
} from "../../secureskills-core/src/index.ts";

function printUsage(): void {
  console.log(`Usage:
  secureskills setup [--encrypt-by-default] [--root <path>]
  secureskills add <source> --skill <name> [--encrypt] [--root <path>]
  secureskills verify [--root <path>]
  secureskills inspect <skill> [--root <path>]
  secureskills run [--root <path>] -- <command...>`);
}

function pullOption(argumentsList: string[], optionName: string): string | undefined {
  const index = argumentsList.indexOf(optionName);
  if (index === -1) {
    return undefined;
  }

  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }

  argumentsList.splice(index, 2);
  return value;
}

function pullFlag(argumentsList: string[], flagName: string): boolean {
  const index = argumentsList.indexOf(flagName);
  if (index === -1) {
    return false;
  }

  argumentsList.splice(index, 1);
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    printUsage();
    return;
  }

  const rootArg = pullOption(args, "--root");
  const projectRoot = path.resolve(rootArg ?? process.cwd());
  const command = args.shift();

  switch (command) {
    case "setup": {
      const encryptByDefault = pullFlag(args, "--encrypt-by-default");
      const result = await setupProject(projectRoot, { encryptByDefault });
      console.log(`initialized ${result.secureSkillsDir}`);
      console.log(`default encryption: ${result.encryptByDefault ? "enabled" : "disabled"}`);
      return;
    }

    case "add": {
      const source = args.shift();
      if (!source) {
        throw new Error("Missing source for add");
      }

      const skillName = pullOption(args, "--skill");
      if (!skillName) {
        throw new Error("Missing --skill for add");
      }

      const encrypt = pullFlag(args, "--encrypt");
      const result = await addSkill(projectRoot, source, skillName, encrypt ? { encrypt: true } : {});
      console.log(
        `installed ${result.skillName} from ${result.sourceType}:${result.sourceRef} (${result.encrypted ? "encrypted" : "plaintext"})`,
      );
      return;
    }

    case "verify": {
      const report = await verifyProject(projectRoot);
      for (const bundle of report.bundles) {
        if (bundle.ok) {
          console.log(`ok   ${bundle.skillName} (${bundle.encrypted ? "encrypted" : "plaintext"})`);
          continue;
        }

        console.error(`fail ${bundle.skillName}`);
        for (const error of bundle.errors) {
          console.error(`  ${error}`);
        }
      }

      for (const warning of report.warnings) {
        console.error(`warn ${warning}`);
      }

      process.exitCode = report.ok ? 0 : 1;
      return;
    }

    case "inspect": {
      const skillName = args.shift();
      if (!skillName) {
        throw new Error("Missing skill name for inspect");
      }

      const result = await inspectSkill(projectRoot, skillName);
      console.log(`skill: ${result.skillName}`);
      console.log(`verified: ${result.verified ? "yes" : "no"}`);
      console.log(`source: ${result.manifest.source.type}:${result.manifest.source.ref}`);
      console.log(`installed: ${result.manifest.installedAt}`);
      console.log(`encrypted: ${result.manifest.encryption.enabled ? "yes" : "no"}`);
      console.log(`files: ${result.manifest.files.length}`);
      if (!result.verified) {
        for (const error of result.errors) {
          console.error(`error ${error}`);
        }
        process.exitCode = 1;
      }
      return;
    }

    case "run": {
      const separatorIndex = args.indexOf("--");
      const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);
      const exitCode = await runAgentCommand(projectRoot, commandArgs);
      process.exitCode = exitCode;
      return;
    }

    default:
      printUsage();
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
