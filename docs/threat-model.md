# PlaTo Threat Model

## Goal

PlaTo is designed to make agent skill exposure explicit and locally authorized.

Its core goal is narrow:

- install skills through a controlled path
- sign and verify the locally installed bundle
- expose only authorized skills to the managed runtime
- exclude loose or tampered skill files from the PlaTo-managed skill view

## What PlaTo Protects Against

PlaTo is intended to reduce the risk that an agent silently picks up unauthorized local skills from paths such as:

- `.agents/skills`
- `skills`

Within its managed runtime flow, PlaTo verifies installed bundles and excludes loose local skill files that were not installed through PlaTo.

## What PlaTo Does Not Currently Solve

PlaTo does not currently provide:

- publisher trust or public-key infrastructure for skill authors
- assurance that a GitHub source repo is safe
- a full host or OS sandbox for the launched agent
- complete protection against a local process that already has enough privilege to invoke the installer itself
- complete prevention of same-user mutation after the agent has started

## Current Trust Model

PlaTo v1 uses a local trust root:

- each project creates its own signing keypair
- installed bundle manifests are signed by that local key
- runtime verification checks the signature and file digests before exposing a skill

This means PlaTo proves local authorization, not upstream publisher authenticity.

## Runtime Boundary

PlaTo currently launches agents inside a verified temporary workspace and controls the visible skill paths there.

This provides:

- pre-launch verification of installed secured bundles
- exclusion of loose local skills from the managed runtime view
- narrowed launch environments for wrapped agent sessions
- read-only unlocked runtime skill trees during execution
- post-launch mutation detection with session termination on detected drift

This does not create a full isolation boundary. The agent still runs with the user's normal account permissions.

## Installer Authority

If malicious code is already running with enough local privilege, it may still be able to invoke the normal installer flow and authorize a malicious skill through the legitimate local trust root.

That is a known limitation and a follow-up hardening area.

## Roadmap Areas

Current follow-up hardening areas include:

- stronger first-time source approval controls
- repository or owner allowlists
- stronger isolation from unlocked runtime skill material
- reduced or eliminated writable plaintext materialization
- live validation of Claude integration with a real subscribed environment
