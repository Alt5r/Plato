# SecureSkills

SecureSkills is a local-first skill authorization tool for Markdown-based coding-agent skills.

It provides:

- a reusable core library for setup, install, verify, inspect, and runtime materialization
- a thin CLI for project workflows
- optional at-rest encryption layered on top of mandatory local authorization

## Local Usage

```bash
npm run cli -- setup
npm run cli -- add ./fixtures/sources/mock-skills --skill find-skills
npm run cli -- verify
```

## Test

```bash
npm test
```
