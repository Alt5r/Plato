# PlaTo Release Refs And Governance

Date: 2026-03-16

## Goal

Make PlaTo's release-channel installer story concrete and add the minimum governance documentation expected for an early-stage security-sensitive project.

This round covers:

- real release refs for `stable`, `latest`, and `experimental`
- MIT licensing
- security reporting guidance
- a concise threat-model document
- documentation cleanup to reflect the current project state

## Release Refs

PlaTo now supports named installer targets through `release-channels.json`.

To make those targets real:

- create tag `v0.1.0`
- create branch `experimental`
- keep `latest` mapped to `main`

Resulting channel behavior:

- `stable` -> `v0.1.0`
- `latest` -> `main`
- `experimental` -> `experimental`

`experimental` may point to the same commit as `main` initially. The purpose is to establish the ref now so future experimental work has a defined channel.

## Governance Files

The project should ship with:

- `LICENSE` using the MIT license
- `SECURITY.md`
- `docs/threat-model.md`

These files should not claim protections the implementation does not provide.

## SECURITY.md Scope

`SECURITY.md` should cover:

- how to report a vulnerability
- what information is useful in a report
- a request not to publicly disclose before maintainers have acknowledged the issue
- a concise note that PlaTo is still early-stage and does not offer a formal response SLA

## Threat Model Document

The threat-model document should explain:

- PlaTo's actual goal: local authorization and runtime exclusion of unauthorized skills
- what PlaTo does not currently solve:
  - publisher trust / PKI
  - full host sandboxing
  - local compromise with installer authority
  - complete runtime immutability
- what the current runtime and installer hardening does provide

The document should match the code and README rather than introducing aspirational claims.

## Documentation Updates

`README.md` and `INSTALL.md` should be updated to mention:

- the meaning of `stable`, `latest`, and `experimental`
- exact version installs via tags
- where to find the threat model and security-reporting guidance

`TODO.md` should be updated so completed hardening work is no longer shown as pending, and remaining governance and runtime work is grouped more clearly.

## Non-Goals

This round does not include:

- signed tags
- release automation
- changelog policy
- runtime redesign
