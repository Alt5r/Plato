## Claude Integration Design

### Goal

Add Claude Code support with the same user experience as the existing Codex integration:

- `secureskills enable claude`
- plain `claude` inside enabled repos
- verified skill exposure through PlaTo
- no replacement of the real `claude` binary

### Product Direction

Claude integration should match the existing Codex model as closely as possible:

- same per-repo enablement flow
- same home-directory shell-hook installation model
- same verified workspace runtime
- same write-through behavior so project edits persist to the real repo

The user should not have to learn a separate mental model for different agents.

### Runtime Contract

This design assumes Claude Code can consume the same `.agents/skills` and `skills` runtime view that PlaTo already prepares for Codex. Under that assumption, Claude does not need a separate instruction bridge in v1.

PlaTo will therefore:

- launch `claude` inside the verified workspace
- expose only authenticated skills through the managed runtime skill directories
- exclude loose or rogue local skills that were not installed through PlaTo
- sync ordinary project edits back to the real repo

### Shell Integration

Public commands:

- `secureskills enable claude`
- `secureskills disable claude`
- `secureskills doctor claude`

Implementation behavior:

- a home-directory `zsh` hook defines a `claude()` shell function
- outside enabled repos, the shell function forwards directly to the real `claude`
- inside enabled repos, the shell function routes through PlaTo first
- no writes to system directories
- no `sudo`
- no replacement of the real `claude` binary

Repo-local enablement lives under:

- `.secureskills/integrations/claude.json`

### Installer Behavior

The installer should not preinstall every available agent hook.

Rules:

- if neither `codex` nor `claude` is installed, do not prompt
- if one supported agent is present, prompt whether to preinstall that hook
- if both are present, prompt which one to preinstall first:
  - `codex`
  - `claude`
  - `skip`

For automation, support:

- `PLATO_DEFAULT_AGENT=codex`
- `PLATO_DEFAULT_AGENT=claude`
- `PLATO_DEFAULT_AGENT=skip`

If a hook was not installed during setup, `secureskills enable <agent>` should still install it as a fallback.

### Implementation Shape

Refactor the current Codex-specific integration layer into a host-parameterized module that can describe:

- binary name
- marker path
- shell-hook path
- metadata file paths
- user-facing labels and messages

Codex behavior should remain unchanged after the refactor.

### Testing

Because live Claude auth is unavailable on this machine, verification should rely on integration tests with a fake `claude` executable.

Coverage should include:

- Claude hook installation
- Claude repo enablement and disablement
- Claude doctor reporting
- Claude launch from nested directories
- authenticated skill visible
- rogue skill hidden
- file edits persisted back to the real project
- installer prompt and non-interactive selection behavior where practical
