# SecureSkills Design

Date: 2026-03-10

## Goal

Build a reusable library with a thin CLI wrapper that secures Markdown-based agent skills before they are exposed to an agent runtime. The hard requirement is local user or project authorization. Confidentiality at rest is optional and layered on top.

## Architecture

The project is split into two public packages and one internal support area:

- `packages/secureskills-core`: source of truth for manifests, cryptography, source ingestion, verification, unlock, and runtime materialization.
- `packages/secureskills-cli`: thin command interface over the core library.
- `fixtures/` and `tests/`: local fixture skills plus integration and tamper coverage.

Project state lives under `.secureskills/`:

- `config.json`: local settings, key metadata, and default policy.
- `keys/`: signing keypair plus the local master encryption key.
- `store/`: installed secured skill bundles.
- `lock.json`: summary of installed bundles and manifest digests.

## Security Model

### Authorization

- `secureskills setup` generates a local `Ed25519` keypair.
- The private key signs each installed bundle manifest.
- The public key is used for verification before any runtime exposure.

### Confidentiality

- Encryption is optional and enabled per install or by default in project config.
- Each bundle gets a random content key.
- Files are encrypted with `AES-256-GCM`.
- The content key is wrapped with a local master key stored in `.secureskills/keys/`.

This keeps authorization asymmetric and confidentiality local.

## Bundle Format

Each installed skill is stored as a bundle directory:

- `manifest.json`
- `manifest.sig`
- `payload/<skill files>`

The manifest records:

- source reference and source type
- skill name and install timestamp
- per-file plaintext and stored digests
- encryption mode and wrapped-key metadata when enabled
- signature algorithm and content cipher metadata

## Runtime Model

Two runtime paths are supported:

- Library integration: agents call the core API directly to verify and unlock bundles.
- Wrapper integration: `secureskills run -- <agent command>` builds an ephemeral workspace containing only verified skills under `.agents/skills` and `skills`.

Loose Markdown files are never included in the generated runtime view.

## CLI

- `secureskills setup`
- `secureskills add <source> --skill <name> [--encrypt]`
- `secureskills verify`
- `secureskills inspect <skill>`
- `secureskills run -- <agent command...>`

## Error Handling

- Signature mismatch: hard fail
- Digest mismatch: hard fail
- Decryption failure: hard fail for encrypted bundles
- Partial install: prevented with staging plus atomic rename
- Stray Markdown files: ignored by runtime generation and reported by `verify`

## Testing

- Unit coverage for canonical manifest generation, signing, verification, encryption, and lockfile updates
- Integration coverage for `setup`, `add`, `verify`, `inspect`, and `run`
- Tamper coverage for file modification, manifest modification, missing signatures, loose Markdown injection, and encrypted payload corruption

## V1 Scope

- local trust root only
- local-directory and git-based source ingestion
- Markdown skill bundles with adjacent assets
- no publisher PKI
- no remote key sync
- no transparent filesystem enforcement outside the wrapper or library contract
