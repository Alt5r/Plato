# PlaTo

> Secure skills for coding agents.

PlaTo lets you install Markdown-based agent skills from GitHub with the same simple flow people already use for `skills.sh`, but with a local trust gate in front of them. Skills are secured when installed, verified before use, and only then exposed to the agent runtime.

```bash
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
```

The CLI command is `secureskills`.

## Why This Matters

Agent skills are instructions. If an agent loads a loose or rogue `SKILL.md` from the current repo, that file can influence how the agent behaves.

PlaTo changes that model:

- skills are installed through an explicit secure path
- the project generates its own local trust root
- installed bundles are signed and verified before runtime exposure
- loose or tampered skill files are not surfaced through the PlaTo-managed runtime

That means the agent only sees skills your local project has actually authorized, instead of whatever happens to be sitting in `.agents/skills`.

## Quick Start

Install PlaTo:

```bash
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
exec zsh
```

Create or enter a project, install a skill, enable Codex integration, then use normal `codex`:

```bash
mkdir plato-demo
cd plato-demo
secureskills add https://github.com/vercel-labs/agent-skills --skill react-best-practices
secureskills enable codex
codex
```

If `codex` was already installed when PlaTo was installed, the installer preconfigures the `zsh` hook and the one-time `exec zsh` above is enough. After that, `secureskills enable codex` is a per-repo action and plain `codex` continues to work.

## What PlaTo Does

- Installs skills from GitHub repos, `owner/repo` shorthand, git URLs, or local directories.
- Auto-initializes `.secureskills/` on first install.
- Signs installed manifests with a local project key.
- Verifies signatures and file digests before runtime exposure.
- Optionally encrypts stored skill payloads at rest.
- Exposes only authenticated skills through `secureskills run` or the Codex integration.
- Leaves the real `codex` binary untouched.

## What It Feels Like

PlaTo keeps the user-facing install flow close to `skills.sh`:

```bash
secureskills add https://github.com/vercel-labs/skills --skill find-skills
secureskills add https://github.com/microsoft/github-copilot-for-azure --skill azure-prepare
secureskills add anthropics/skills --skill skill-creator
```

The difference is what happens after install: PlaTo secures the bundle locally and only exposes it again after verification.

## How It Works

### Plain-English Version

When you add a skill, PlaTo does not just copy a `SKILL.md` into your project. It builds a secured local bundle, records what was installed, and verifies that bundle before an agent gets access to it.

When you run an agent through PlaTo, or use Codex in a repo that has been enabled, PlaTo prepares a verified runtime view that contains authenticated skills only. Loose repo-local skills that were never installed through PlaTo are excluded from that runtime.

### Technical Trust Model

- `secureskills setup` or the first `secureskills add` creates a local project trust root.
- Installed bundles get a canonical manifest plus a signature.
- File contents are hashed and rechecked before runtime exposure.
- Optional confidentiality uses encrypted payload storage in the local secured store.
- Codex integration launches from a verified workspace so the secure skill surface is controlled by PlaTo.
- Normal project edits still write back to the real project; the secure workspace is only there to control what skills are visible.

This is a local-first model. In v1, trust is owned by the user or project, not by a remote publisher PKI.

## Commands

```bash
secureskills setup [--encrypt-by-default] [--root <path>]
secureskills add <source> --skill <name> [--encrypt] [--root <path>]
secureskills enable codex [--root <path>]
secureskills disable codex [--root <path>]
secureskills doctor codex [--root <path>]
secureskills verify [--root <path>]
secureskills inspect <skill> [--root <path>]
secureskills run [--root <path>] -- <command...>
secureskills uninstall
```

If you are outside the target project directory, pass `--root /path/to/project`.

## Codex Integration

PlaTo's first zero-extra-command integration target is Codex.

Inside an enabled repo:

```bash
secureskills add https://github.com/vercel-labs/agent-skills --skill react-best-practices
secureskills enable codex
codex
```

Outside enabled repos, `codex` behaves normally.

The integration model is intentionally conservative:

- no replacement of the real `codex` binary
- no `sudo`
- no writes to system directories
- shell hook lives in the user's home directory
- enablement is explicit and per repo

Use this command if you want to check whether the integration is active:

```bash
secureskills doctor codex
```

## Development And Testing

Requirements:

- `node`
- `npm`
- `git`

The current CLI runs TypeScript directly with Node's `--experimental-strip-types`, so use a modern Node version that supports it.

Run tests:

```bash
npm test
```

Run the CLI from the repo checkout:

```bash
npm run cli -- add ./fixtures/sources/mock-skills --skill find-skills
npm run cli -- verify
```

## Project Layout

- `packages/secureskills-core`
  Library logic for setup, install, verification, manifests, encryption, and runtime handling.
- `packages/secureskills-cli`
  CLI commands and Codex integration.
- `fixtures/`
  Test fixtures for skills and source repos.
- `tests/`
  End-to-end and regression coverage.

## Limits And Roadmap

PlaTo v1 is deliberately narrow:

- trust root is local to the user or project
- GitHub and local skill-source flows are supported
- Codex is the first zero-extra-command integration target
- other agents can still be launched through `secureskills run`

Known deferred work:

- stronger runtime hardening against same-user mutation of the unlocked skill view
- publisher-signing and richer remote trust policies
- tighter approval controls for first-time or untrusted remote sources
- broader host integrations beyond Codex

One important boundary: if malicious code is already running with enough local privilege, it can still invoke the legitimate installer path and authorize a malicious skill through the local trust root. That is documented as a follow-up security problem, not a solved one in v1.

## Install Details

For local installation, custom install directories, and uninstall instructions, see [INSTALL.md](./INSTALL.md).
