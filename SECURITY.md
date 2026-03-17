# Security Policy

PlaTo is an early-stage project. If you believe you have found a security issue, please report it privately before opening a public issue.

## Reporting

Use GitHub's private vulnerability reporting for this repository if it is enabled.

If private reporting is unavailable, contact the maintainer directly through GitHub and avoid
posting technical details in a public issue until the report has been acknowledged.

## What To Include

Useful reports include:

- a clear description of the issue
- affected PlaTo version, commit SHA, or install target
- reproduction steps or a minimal proof of concept
- expected impact
- any relevant environment details such as OS, shell, and agent host

## Disclosure

Please avoid public disclosure before the issue has been acknowledged and triaged.

PlaTo does not currently offer a formal response SLA. Security fixes may ship quickly and iteratively as the project matures.

## Security Scope

PlaTo is designed to enforce local authorization of installed skills and exclude unauthorized loose skills from the managed runtime view.

PlaTo does not currently provide:

- publisher PKI or remote trust guarantees
- a full host sandbox
- complete protection against a sufficiently privileged local compromise
- complete post-launch runtime immutability

For the current trust boundary and non-goals, see [docs/threat-model.md](docs/threat-model.md).
