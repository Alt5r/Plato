# Install

## One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
```

This installs PlaTo into a stable local directory and makes the `secureskills` command available system-wide through npm global installation.

## Requirements

- `node`
- `npm`
- `git`

The current CLI uses Node's `--experimental-strip-types` support, so use a modern Node release that supports it.

## What The Installer Does

1. Prints the PlaTo ASCII banner.
2. Checks for `node`, `npm`, and `git`.
3. Clones `https://github.com/Alt5r/Plato.git` into `~/.local/share/plato` by default.
4. Updates that checkout if it already exists.
5. Runs `npm install -g <install-dir>`.

You can override the install directory:

```bash
PLATO_INSTALL_DIR="$HOME/tools/plato" curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
```

## Local Repo Install

From a local checkout:

```bash
cd /Users/rowan/Documents/Plato
npm install -g .
```

## Commands

From any directory after installation:

```bash
secureskills add https://github.com/vercel-labs/skills --skill find-skills
secureskills add https://github.com/microsoft/github-copilot-for-azure --skill azure-prepare
secureskills add anthropics/skills --skill skill-creator
secureskills enable codex
secureskills disable codex
secureskills doctor codex
secureskills verify
secureskills inspect find-skills
secureskills run -- node your-agent.js
secureskills uninstall
```

If you are running commands outside the target project directory, pass `--root /path/to/project`.

## Codex Integration

Inside a project where you want normal `codex` usage to go through Plato:

```bash
cd /path/to/project
secureskills add https://github.com/vercel-labs/agent-skills --skill react-best-practices
secureskills enable codex
```

After that, just run:

```bash
codex
```

The first enable writes a small `zsh` hook in your home directory and adds one `source` line to your shell profile. It does not replace the real `codex` binary or write to system directories.

## Uninstall

```bash
secureskills uninstall
```

This removes the globally installed PlaTo tool and deletes the managed install checkout directory. It does not touch `.secureskills/` data inside user projects.

If you installed to a custom directory:

```bash
PLATO_INSTALL_DIR="$HOME/tools/plato" secureskills uninstall
```
