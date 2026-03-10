export interface ProjectConfig {
  version: number;
  createdAt: string;
  defaults: {
    encrypt: boolean;
  };
  runtime: {
    skillMountPaths: string[];
  };
}

export interface LockfileEntry {
  skillName: string;
  sourceType: "local" | "git";
  sourceRef: string;
  installedAt: string;
  manifestSha256: string;
  encrypted: boolean;
}

export interface Lockfile {
  version: number;
  updatedAt: string;
  skills: Record<string, LockfileEntry>;
}

export interface WrappedKeyMetadata {
  algorithm: "aes-256-gcm";
  nonce: string;
  wrappedKey: string;
  tag: string;
}

export interface ManifestFileEntry {
  relativePath: string;
  storedPath: string;
  plaintextSha256: string;
  storedSha256: string;
  plaintextSize: number;
  storedSize: number;
}

export interface BundleManifest {
  version: number;
  skillName: string;
  source: {
    type: "local" | "git";
    ref: string;
  };
  installedAt: string;
  signatureAlgorithm: "ed25519";
  encryption: {
    enabled: boolean;
    fileAlgorithm: "aes-256-gcm" | null;
    wrappedKey: WrappedKeyMetadata | null;
  };
  files: ManifestFileEntry[];
}

export interface ProjectPaths {
  rootDir: string;
  secureSkillsDir: string;
  configPath: string;
  lockPath: string;
  keysDir: string;
  storeDir: string;
  runtimeDir: string;
  signingPrivateKeyPath: string;
  signingPublicKeyPath: string;
  masterKeyPath: string;
}

export interface ProjectContext {
  rootDir: string;
  paths: ProjectPaths;
  config: ProjectConfig;
  signingPrivateKeyPem: string;
  signingPublicKeyPem: string;
  masterKey: Buffer;
}

export interface SetupOptions {
  encryptByDefault?: boolean;
}

export interface SetupResult {
  rootDir: string;
  secureSkillsDir: string;
  encryptByDefault: boolean;
}

export interface AddSkillOptions {
  encrypt?: boolean;
}

export interface AddSkillResult {
  skillName: string;
  encrypted: boolean;
  sourceType: "local" | "git";
  sourceRef: string;
  destination: string;
  manifestSha256: string;
}

export interface VerifyBundleResult {
  skillName: string;
  ok: boolean;
  encrypted: boolean;
  errors: string[];
  manifest: BundleManifest | null;
}

export interface VerifyReport {
  ok: boolean;
  bundles: VerifyBundleResult[];
  warnings: string[];
}

export interface InspectResult {
  skillName: string;
  manifest: BundleManifest;
  verified: boolean;
  errors: string[];
}

export interface VerifiedWorkspace {
  workspaceDir: string;
  runtimeSkillsDir: string;
  cleanup: () => Promise<void>;
}
