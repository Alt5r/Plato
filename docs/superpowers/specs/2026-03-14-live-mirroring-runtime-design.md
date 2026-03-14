## Live Mirroring Runtime Design

### Problem

PlaTo currently isolates authenticated skills correctly by launching agents inside a verified temporary workspace. Ordinary project edits from that workspace are synchronized back to the real project only after the agent process exits. This means users do not see generated or modified files appear in the real repository during the session.

### Goal

Keep the verified runtime workspace and secure skill filtering, but mirror ordinary project changes back into the original project directory while the agent is still running.

### Recommended Approach

Add a live mirroring layer to the verified workspace runtime. While the agent process is running, PlaTo should watch the writable workspace view and immediately mirror ordinary filesystem changes into the real project. The current full sync on exit should remain as a final consistency pass.

### Runtime Rules

- `.agents`, `skills`, `.secureskills`, and `.git` remain Plato-managed and must never be mirrored into the real project.
- ordinary project files and directories are mirrored live
- file creation, modification, deletion, and directory changes are propagated during the session
- rename and move operations may be represented internally as delete plus create if needed
- a final full sync still runs when the agent exits in case any watcher event was missed

### Expected Result

- authenticated skills remain isolated to the verified runtime view
- rogue loose skills remain excluded
- generated or modified project files become visible in the real repo while the session is still active
- the project directory remains consistent after the session exits

### Testing

Regression coverage should prove that, during a running wrapped agent session:

- a new file appears in the real project before the process exits
- a modified file updates in the real project before the process exits
- a deleted file disappears from the real project before the process exits
- authenticated skills remain visible
- rogue loose skills remain hidden
