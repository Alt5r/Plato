## Codex Write-Through Runtime Design

### Problem

Plato currently launches Codex inside a temporary verified workspace so only authenticated skills are visible. That isolates skills correctly, but when Codex starts from a nested project directory it can create new files inside the temporary workspace instead of the real project.

### Goal

Keep the secure Plato-managed skill surface while making normal project edits persist to the original repository without adding extra commands to the user workflow.

### Recommended Approach

Retain the temporary verified workspace for secure skill exposure, but add a write-through synchronization layer for the materialized launch path. Existing project files should continue to resolve back to the original repository, and any new files or directory changes created inside the temporary launch path should be mirrored back into the real project during the Codex session lifecycle.

### Runtime Behavior

- `.agents/skills` and `skills` remain owned by Plato and point only to the verified runtime skills.
- The workspace still launches from a temporary root so Codex discovers the secure skill mounts instead of the live project skill tree.
- For nested launch directories, Plato tracks the materialized directory chain that exists only in the temporary workspace.
- Before the workspace is cleaned up, Plato synchronizes ordinary file changes from those tracked directories back into the real project tree.
- Secure runtime paths and `.secureskills` metadata are excluded from synchronization.

### Testing

Regression coverage should prove both of these together:

- rogue loose skills remain invisible to Codex in the verified runtime
- a file created by Codex from a nested working directory appears in the real project after the wrapped launch completes
