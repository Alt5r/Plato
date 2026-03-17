# PlaTo Runtime Mutation Detection

Date: 2026-03-17

## Goal

Detect post-launch mutation of the unlocked runtime skill view and fail closed when it happens.

This round focuses on detection and response. It does not attempt to fully prevent runtime mutation or to make the runtime view read-only yet.

## Runtime Integrity Snapshot

After PlaTo materializes the verified runtime skill directory, it should build an integrity snapshot containing:

- expected runtime file paths
- expected file type for each path
- expected file digest for each file

The snapshot covers the unlocked runtime skill tree only.

## Detection Model

While the wrapped agent process is running:

- watch the runtime skill directory for filesystem changes
- on change, inspect the affected path or fall back to a broader verification pass if needed
- compare the current state against the expected snapshot

The following count as runtime integrity violations:

- a new file appears in the runtime skill tree
- an expected file disappears
- a file's content digest changes
- a file type changes
- a symlink appears anywhere in the runtime skill tree

## Response

On a detected runtime mutation:

- write a clear error to stderr
- terminate the wrapped agent process
- return a non-zero exit status
- still clean up the temporary workspace afterward

The detector should fail closed.

## Scope

The mutation detector applies to the shared runtime used by:

- `secureskills run`
- `codex` integration
- `claude` integration

## Testing

Regression coverage should include:

- modifying a runtime skill file during the session
- creating an extra file in the runtime skill tree
- deleting a runtime skill file
- creating a symlink in the runtime skill tree

The expected outcome in each case is that PlaTo detects the mutation and terminates the wrapped process with a non-zero exit code.

## Non-Goals

This round does not include:

- read-only runtime permissions
- mount-based isolation
- installer-authority controls
- broader sandboxing
