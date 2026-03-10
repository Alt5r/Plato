import { readJsonFile } from "./fs-utils.ts";
import { loadProject } from "./config.ts";
import { MANIFEST_FILE } from "./constants.ts";
import { verifyInstalledSkill } from "./verify.ts";
import path from "node:path";

import type { BundleManifest, InspectResult } from "./types.ts";

export async function inspectSkill(projectRoot: string, skillName: string): Promise<InspectResult> {
  const project = await loadProject(projectRoot);
  const manifest = await readJsonFile<BundleManifest>(path.join(project.paths.storeDir, skillName, MANIFEST_FILE));
  const verification = await verifyInstalledSkill(projectRoot, skillName);

  return {
    skillName,
    manifest,
    verified: verification.ok,
    errors: verification.errors,
  };
}
