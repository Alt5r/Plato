# PlaTo Read-Only Runtime Skills

Date: 2026-03-17

## Goal

Make the unlocked runtime skill tree read-only during agent execution while keeping the existing runtime mutation detector as a backstop.

This round also updates roadmap documentation so it reflects the current shipped state.

## Runtime Permission Model

After PlaTo materializes verified runtime skills:

- runtime skill files should become read-only
- runtime skill directories should become non-writable but still traversable

This applies only to the unlocked runtime skill tree.

It does not apply to:

- normal project files
- `.secureskills` project state outside the temporary runtime view
- the real repository tree

## Expected Behavior

The agent should still be able to read and use runtime skills.

Direct attempts to:

- overwrite a runtime skill file
- delete a runtime skill file
- create new files inside the runtime skill tree

should fail at the filesystem-permission level on Unix-like systems.

The runtime mutation detector remains active so that if a same-user process does manage to alter permissions and mutate the runtime skill tree, PlaTo still detects the drift and terminates the session.

## Cleanup

Because the runtime skill tree becomes non-writable, PlaTo should relax those permissions during cleanup before removing the temporary workspace.

This keeps workspace teardown reliable without weakening the runtime behavior during the session.

## Documentation

This round updates:

- `TODO.md`
- `docs/threat-model.md`

to reflect that the following are now shipped:

- governance docs
- runtime reconciler and hook reduction
- runtime mutation detection

Remaining runtime roadmap items should focus on stronger isolation rather than the already-shipped baseline protections.

## Testing

Regression coverage should include:

- a fake agent trying to overwrite a runtime skill file and failing
- a fake agent trying to delete a runtime skill file and failing
- existing mutation-detection regressions adjusted so they still exercise the detector by explicitly relaxing permissions before mutating

## Non-Goals

This round does not include:

- installer-authority controls
- OS-level read-only mounts
- full sandboxing
- removal of plaintext runtime materialization
