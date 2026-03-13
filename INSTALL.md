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
6. If `codex` or `claude` is already installed, prompts which supported agent hook to preinstall first.

For non-interactive installs, you can choose this explicitly:

```bash
PLATO_DEFAULT_AGENT=codex curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
PLATO_DEFAULT_AGENT=claude curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
PLATO_DEFAULT_AGENT=skip curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
```

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
secureskills enable claude
secureskills disable codex
secureskills disable claude
secureskills doctor codex
secureskills doctor claude
secureskills verify
secureskills inspect find-skills
secureskills run -- node your-agent.js
secureskills uninstall
```

If you are running commands outside the target project directory, pass `--root /path/to/project`.

## Agent Integration

Inside a project where you want normal `codex` usage to go through Plato:

```bash
exec zsh
cd /path/to/project
secureskills add https://github.com/vercel-labs/agent-skills --skill react-best-practices
secureskills enable codex
```

After that, just run:

```bash
codex
```

Or for Claude:

```bash
exec zsh
cd /path/to/project
secureskills add https://github.com/vercel-labs/agent-skills --skill react-best-practices
secureskills enable claude
claude
```

If `codex` or `claude` was already installed when PlaTo was installed, the installer can preinstall the selected shell hook and shell-profile source line. In that normal case, `enable <agent>` does not require another shell reload.

If the agent was not installed yet when PlaTo was installed, `enable <agent>` will install the shell hook as a fallback and then you should open a new terminal or run:

```bash
exec zsh
```

The integration does not replace the real `codex` or `claude` binaries or write to system directories.

## Uninstall

```bash
secureskills uninstall
```

This removes the globally installed PlaTo tool and deletes the managed install checkout directory. It does not touch `.secureskills/` data inside user projects.

If you installed to a custom directory:

```bash
PLATO_INSTALL_DIR="$HOME/tools/plato" secureskills uninstall
```
