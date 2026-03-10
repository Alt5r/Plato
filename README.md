# SecureSkills

SecureSkills is a local-first skill authorization tool for Markdown-based coding-agent skills.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Alt5r/Plato/main/scripts/install.sh | bash
```

After installation:

```bash
secureskills add https://github.com/vercel-labs/skills --skill find-skills
```

See [INSTALL.md](./INSTALL.md) for local and global installation details.

## What It Does

- secures Markdown-based skills into a signed local bundle store
- auto-initializes `.secureskills/` on first install
- supports local sources, GitHub URLs, and `owner/repo` shorthand
- exposes only authenticated skills through `secureskills run`
- supports optional at-rest encryption for stored payloads

## Install Shape

The intended command shape is:

```bash
secureskills add https://github.com/vercel-labs/skills --skill find-skills
secureskills add https://github.com/microsoft/github-copilot-for-azure --skill azure-prepare
secureskills add anthropics/skills --skill skill-creator
```

`add` auto-initializes `.secureskills/` on first use, then secures the installed skill into the local store.

## Commands

```bash
secureskills add <source> --skill <name>
secureskills add <source> --skill <name> --encrypt
secureskills verify
secureskills inspect <skill>
secureskills run -- <command...>
secureskills uninstall
secureskills setup
```

## Local Development

```bash
npm run cli -- add ./fixtures/sources/mock-skills --skill find-skills
npm run cli -- add https://github.com/vercel-labs/skills --skill find-skills
npm run cli -- verify
```

## Test

```bash
npm test
```
