# UI Notes

SecureSkills is a CLI-first project, so the primary interface is command structure and terminal output.

## Command Surface

- `setup`: initialize local trust material with minimal prompts
- `add`: install and secure a selected skill from a source
- `verify`: produce a short pass or fail report for every installed skill
- `inspect`: show source, digests, encryption state, and verification status for one skill
- `run`: execute an agent command inside a verified temporary workspace

## Output Rules

- success output stays one or two lines when possible
- failures identify the bundle, file, and failed check
- `verify` and `inspect` prefer table-like key-value output over dense prose
- `run` reports the generated workspace path only when `--verbose` is set

## Visibility

- the default UI hides cryptographic implementation detail until it matters
- the user sees whether a skill is authorized, encrypted, tampered, or ignored
- raw key material is never printed
