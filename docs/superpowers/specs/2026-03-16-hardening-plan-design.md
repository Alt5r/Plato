# PlaTo Hardening Plan

Date: 2026-03-16

## Goal

Harden PlaTo's current implementation without changing its v1 trust model.

This plan keeps the local-authorization model intact and focuses on the main implementation risks that were identified during review:

- runtime mirroring attack surface
- key material permissions
- weak skill-name input handling
- unpinned source and installer flows
- missing project-governance basics

## Scope

This hardening plan is phased. The first patch set covers:

- runtime containment hotfixes
- key directory and key file permissions
- strict skill-name validation
- regression tests for those changes

Later phases cover:

- source commit pinning
- installer version pinning
- license and security policy files
- a broader runtime redesign that reduces or removes the current live mirror loop

## Runtime Containment Hotfix

The current runtime model launches agents in a verified temporary workspace and mirrors ordinary project changes back into the real repo.

The immediate hardening change is:

- do not recreate arbitrary symlinks from the temp workspace in the real project
- resolve and validate mirror targets before copy, mkdir, or delete operations
- hard-fail if a mirror operation would escape the project root

Behavioral rule:

- ordinary files and directories can still be mirrored
- protected paths remain excluded
- symlink write-back is blocked unless it is part of the original pass-through project view and can be safely ignored

This keeps the current user experience while removing the most dangerous part of the mirror loop.

## Key Material Permissions

PlaTo currently writes key material using default filesystem permissions.

The hardening change is:

- create `.secureskills/keys` with mode `0700`
- write the signing private key, signing public key, and master key with mode `0600`

This does not change the local trust model. It reduces accidental exposure through permissive default umask settings.

## Skill Name Validation

PlaTo currently relies on skill discovery behavior to block malformed names, but still uses the provided skill name in path joins.

The hardening change is:

- validate skill names before any path construction
- allow only conservative names matching `[A-Za-z0-9._-]+`
- reject empty names, absolute paths, path separators, and `..`

This is a defense-in-depth fix that makes the intended input contract explicit.

## Testing

The first patch set adds regression coverage for:

- attempts to mirror attacker-created symlinks back into the real project
- invalid skill names
- key directory and key file modes on Unix-like platforms

The existing end-to-end tests should continue to pass unchanged for normal install and runtime flows.

## Planned Follow-Up Work

After the first patch set:

1. record resolved git commit SHAs in the manifest and lockfile
2. move the public installer from `main` to tagged or version-selected installs
3. add `LICENSE` and `SECURITY.md`
4. redesign the runtime so normal project content is write-through and only skill visibility is synthesized
