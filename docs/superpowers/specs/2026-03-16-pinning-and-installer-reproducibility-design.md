# PlaTo Pinning And Installer Reproducibility

Date: 2026-03-16

## Goal

Harden PlaTo's installation and source-ingestion paths so they resolve to explicit versions or commits rather than silently following moving refs.

This patch set covers:

- installer target selection through channels or explicit versions
- local installer metadata recording the resolved ref and commit
- resolved commit pinning for git-based skill installs

## Installer Target Resolution

The public installer remains a single shell entrypoint:

```bash
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash -s -- latest
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash -s -- experimental
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash -s -- v0.1.0
```

Behavior:

- no argument defaults to `stable`
- `stable`, `latest`, and `experimental` resolve through a tracked repo file
- explicit versions such as `v0.1.0` are installed directly

The tracked mapping file is:

- `release-channels.json`

Example structure:

```json
{
  "stable": "v0.1.0",
  "latest": "main",
  "experimental": "experimental"
}
```

## Installer Metadata

After install, PlaTo records local metadata inside the install checkout.

Suggested file:

- `.plato-install.json`

Fields:

- requested target
- resolved ref
- resolved commit SHA
- install timestamp

This makes the installed state auditable and simplifies debugging and support.

## Git Skill Source Pinning

For git-based `secureskills add` operations:

- PlaTo clones the requested source
- resolves the checked-out commit SHA
- stores the original source ref and the resolved commit SHA in the manifest
- stores the same resolved commit SHA in the lockfile

This does not change the local trust model. It makes the secured bundle refer to a concrete upstream revision rather than only a moving branch or shorthand ref.

## CLI Behavior

Public CLI behavior stays mostly the same:

- `secureskills add ...` continues to accept the same source formats
- `inspect` should display the resolved source commit when present

The installer should also print the resolved state, for example:

```text
installed PlaTo stable -> v0.1.0 (abc1234)
```

## Testing

This patch set adds coverage for:

- installer target parsing and invalid target handling
- channel resolution through `release-channels.json`
- installer metadata writing
- git source installs recording resolved commit SHAs
- `inspect` surfacing pinned revisions

## Non-Goals

This patch set does not cover:

- signed remote channel manifests
- governance files such as `LICENSE` or `SECURITY.md`
- broader runtime redesign
