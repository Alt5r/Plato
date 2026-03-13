## README Redesign

### Goal

Redesign the public README so it works as both a discovery page and a technical evaluation document. The top half should be optimized for first-time users and general interest, while the lower half should give developers enough detail to understand how PlaTo works and why it matters.

### Audience Order

The README should prioritize:

1. users discovering PlaTo and deciding whether to try it
2. developers evaluating the trust model, integration, and project scope

### Structure

1. Hero
   - Project name
   - One-line pitch
   - Short paragraph framing the problem and PlaTo's value
   - One-line install command

2. Why This Matters
   - Explain that agent skills are instructions that can influence runtime behavior
   - Explain the risk of loose or rogue `SKILL.md` files
   - Explain that PlaTo makes skill exposure explicit and locally authorized

3. Quick Start
   - Install PlaTo
   - Install a real skill from GitHub
   - Enable Codex in a repo
   - Run `codex`
   - Show the user-facing simplicity of the flow

4. What PlaTo Does
   - Securely installs Markdown-based skills from GitHub or local sources
   - Uses local authorization and verification
   - Optionally encrypts stored skill payloads
   - Exposes only authenticated skills at runtime
   - Integrates with Codex without replacing the real binary

5. How It Works
   - Plain-language summary first
   - Technical trust-model details below it

6. Commands
   - Concise command reference

7. Codex Integration
   - Explain the shell hook model
   - Clearly state what changes on the system and what does not

8. Development And Testing
   - Local development commands
   - Test command

9. Limits And Roadmap
   - Current boundary of the project
   - Deferred work such as runtime injection hardening and local-RCE installer abuse

### Tone

- Strong and public-facing at the top
- Plain English first
- Technical precision later
- Confident without sounding inflated or vague

### Constraints

- Keep all claims aligned with current implementation
- Link deeper installation details to `INSTALL.md`
- Preserve concrete commands and examples that users can run today
