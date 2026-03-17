# Launch Environment Isolation Design

## Goal

Reduce what a PlaTo-managed agent session inherits from the host environment at launch.

The current runtime already verifies installed skills, excludes loose local skills, keeps the
runtime skill tree read-only, and detects post-launch mutation. The next isolation step is to
stop forwarding the full parent environment into wrapped `codex` and `claude` sessions.

## Scope

This round focuses only on launch-time environment visibility.

It does not change:

- the verified temp workspace model
- file reconciliation behavior
- runtime mutation detection
- installer-authority policy

## Recommended Approach

Build the child-process environment explicitly instead of inheriting all of `process.env`.

Use a small allowlist from the host environment for execution basics and locale behavior:

- `PATH`
- `HOME`
- `USER`
- `LOGNAME`
- `SHELL`
- `TERM`
- `TMPDIR`
- `PWD`
- `LANG`
- `LC_ALL`
- `LC_CTYPE`

Then merge:

- any explicit `options.env` overrides passed by PlaTo callers
- PlaTo runtime variables:
  - `SECURESKILLS_RUNTIME_DIR`
  - `SECURESKILLS_WORKSPACE_DIR`
  - `SECURESKILLS_ORIGINAL_CWD`

This gives a narrow and auditable default while preserving a controlled compatibility path for
required extras.

## Behavior

Wrapped agent sessions should:

- keep access to basic execution and locale variables
- always receive PlaTo runtime variables
- not inherit arbitrary parent secrets by default

Outside explicitly enabled repos, the shell hook bypass continues to execute the real agent
binary directly, so PlaTo does not mediate the environment there.

## Testing

Add regressions that prove:

- an arbitrary parent secret is not visible to the wrapped process
- allowed variables such as `PATH` remain available
- PlaTo runtime variables remain available
- existing launch integration tests continue to pass

## Documentation

Update:

- `TODO.md` to remove duplicated remaining-runtime sections
- `docs/threat-model.md` to note that wrapped agents now run with a narrowed launch environment

