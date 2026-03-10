# UX Notes

## Primary Flow

1. Install a skill with `secureskills add`.
2. Let the project auto-initialize on first install if needed.
3. Verify current state with `secureskills verify`.
4. Start the agent through `secureskills run`.

## UX Principles

- local authorization is explicit and project-scoped
- first install should feel as simple as `skills.sh` style one-liners
- plaintext compatibility is the default unless the project opts into encryption by default
- tampered or unsigned skills fail closed
- the wrapper path should work without requiring agent-specific plugin code

## Failure Experience

- errors say what failed and what the user can do next
- verification failures point to the exact bundle and file path
- unsupported sources fail before any partial install is committed
- interrupted installs are cleaned up automatically on the next run

## Trust Messaging

- “authorized” means signed by the local project key
- “verified” means the signature and digests both passed
- “encrypted” is presented as additional at-rest protection, not the main trust guarantee
