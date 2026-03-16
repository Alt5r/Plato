# PlaTo Runtime Reconciler And Hook Reduction

Date: 2026-03-16

## Goal

Reduce the remaining always-on attack surface in PlaTo's runtime and agent integration layers without changing the core verified-workspace model.

This round covers:

- replacing the current polling-based live mirror loop with an evented reconciler
- reducing shell-hook interception outside explicitly enabled repositories

## Runtime Direction

PlaTo will keep the verified temporary workspace model.

The redesign does not attempt to eliminate the temp workspace. Instead, it keeps the current architecture and narrows the synchronization surface.

## Evented Reconciler

Replace the current global `50ms` polling loop with a filesystem-watcher-based reconciler.

Behavior:

- watch the writable workspace surface
- enqueue changed paths into a serialized reconciliation loop
- reconcile only the affected path or subtree back into the real project
- keep a final full reconciliation pass on exit as a correctness backstop

## Reconciliation Rules

The following paths remain excluded from write-back:

- `.agents`
- `skills`
- `.secureskills`
- `.git`

For writable project content:

- creates are mirrored to the real project
- modifications are mirrored to the real project
- deletes are mirrored to the real project
- rename and move operations may be handled internally as delete plus create

Every mirrored destination path must still be canonicalized and validated against the real project root.

Unexpected workspace-created symlinks remain forbidden and must not be mirrored into the real project.

## File Write Safety

When mirroring files back into the real project:

- write into a temporary sibling path first where practical
- rename into place to reduce partial-write windows

The final exit reconciliation remains authoritative if an intermediate event is missed.

## Shell Hook Reduction

The generated `codex()` and `claude()` shell functions should do a lightweight repo-marker check in shell before invoking Plato.

Behavior:

- outside an enabled repo, exec the real binary directly
- inside an enabled repo, route through `secureskills launch <agent> -- ...`

This keeps the same user workflow while reducing global interception behavior.

## Testing

This round adds coverage for:

- create, modify, delete, and rename propagation under the evented reconciler
- refusal to mirror workspace-created symlinks
- path validation during watched reconciliation
- shell hook direct passthrough outside enabled repos
- shell hook Plato routing inside enabled repos

## Non-Goals

This round does not cover:

- full host sandboxing
- complete post-launch runtime immutability
- installer-authority policy changes
