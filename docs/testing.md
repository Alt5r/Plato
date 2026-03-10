# Testing Strategy

## Coverage Targets

- key generation and config initialization
- canonical manifest generation and signature verification
- plaintext installs and encrypted installs
- tamper detection for stored payloads and manifests
- ephemeral runtime generation for wrapped agent execution

## Test Types

- unit tests for cryptographic helpers and manifest canonicalization
- integration tests for setup, add, verify, inspect, and run
- regression tests for loose Markdown injection and partial installs

## Tamper Cases

- modify a stored payload file
- modify a signed manifest
- remove a signature file
- corrupt an encrypted payload
- add stray `.md` files outside the secured store

## Success Criteria

- only signed, verified bundles appear in the runtime workspace
- encrypted bundles decrypt only after signature and digest checks pass
- runtime cleanup occurs even if the child process exits with an error
