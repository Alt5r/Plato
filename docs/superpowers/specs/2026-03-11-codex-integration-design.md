# Plato Codex Integration Design

Date: 2026-03-11

## Goal

Provide a zero-extra-command Codex workflow for Plato-managed repositories so users can keep typing `codex` in their normal terminal flow while Plato prepares and exposes only verified skills.

## UX

The user flow is:

1. Install Plato globally.
2. Install skills into a repo with `secureskills add ...`.
3. Run `secureskills enable codex` once in that repo.
4. Keep using `codex` normally inside that repo.

Inside enabled repositories, Plato should intercept `codex`, verify secured skills, prepare the secure runtime view, and then hand off to the real Codex binary.

Outside enabled repositories, `codex` should behave exactly as it did before.

## Integration Model

This integration uses a home-directory shell hook rather than binary replacement.

### One-Time User-Level Setup

- install a small shell hook under a Plato-managed directory in the user's home folder
- add one `source` line to the user's shell profile
- record the real `codex` executable path so the wrapper can forward correctly

### Per-Repo Enablement

- `secureskills enable codex` writes a repo-local integration marker under `.secureskills/`
- `secureskills disable codex` removes that marker
- `secureskills doctor codex` reports shell-hook status, real `codex` discovery, and current repo enablement state

## Safety Boundary

The integration must not:

- replace the real `codex` binary
- write to system directories
- require `sudo`
- modify anything outside the user's home directory and the opted-in repository

This keeps the change reversible and low-risk.

## Runtime Behavior

When the shell wrapper detects that the current repository is Codex-enabled:

1. Plato verifies the secured bundles.
2. Plato creates the verified temporary runtime workspace.
3. Plato launches the real `codex` inside that workspace.
4. Plato cleans up temporary runtime state when the process exits.

When the repository is not enabled:

- the wrapper forwards directly to the real `codex`

## Repo State

Codex integration state should live under `.secureskills/`, for example:

- `.secureskills/integrations/codex.json`

This state records that the repo opted into Plato-managed Codex execution.

## Shell State

The shell integration lives under a Plato-managed user directory, for example:

- `~/.config/plato/shell/codex.zsh`
- `~/.config/plato/metadata/codex-path`

The shell profile contains a single sourced line pointing to the hook.

## Failure Behavior

- if the real `codex` binary cannot be found, `enable codex` fails clearly
- if the shell profile cannot be updated, Plato should not partially enable the repo
- if the repo is already enabled, Plato should return success with a no-op style message
- if the shell hook is broken, `doctor codex` should explain the missing path or config

## Scope

### Phase One

- target `zsh`
- support terminal-launched Codex
- explicit `enable codex`
- explicit `disable codex`
- explicit `doctor codex`
- no VS Code extension interception
- no Claude Code integration
- no runtime immutability guarantees beyond the current verified-workspace model

### Phase Two

Runtime hardening after launch remains a separate enhancement area. The current verified-workspace model protects pre-launch integrity, but it does not fully prevent same-user runtime injection into the unlocked skills directory after Codex starts.

This should be tracked for a later phase and may include:

- read-only runtime skill directories
- post-launch mutation detection
- stronger isolation from the unlocked skill view
- agent-native read-only loading instead of writable plaintext materialization

## Summary

The approved first version is a low-invasiveness Codex integration:

- one-time shell hook in the user's home directory
- explicit per-repo opt-in
- plain `codex` command preserved
- Plato mediation only inside enabled repos
- runtime hardening tracked as phase two rather than bundled into the initial integration
