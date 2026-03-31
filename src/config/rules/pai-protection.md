# PAI Scaffolding Protection

## Critical: Do NOT modify PAI core files directly

The `~/.claude/PAI/` directory contains the upstream PAI (Personal AI Infrastructure) scaffolding. These files are managed by the PAI upstream repository and will be **overwritten** when a new version of PAI is pulled.

### Protected paths (do not write/edit directly):
- `~/.claude/PAI/` — Algorithm, context routing, formats, all PAI core logic
- `~/.claude/skills/` — PAI skill definitions (upstream-managed)
- `~/.claude/CLAUDE.md` — PAI system prompt (upstream-managed)

### What to do instead:
1. **All behavioral changes** should go through the **PAI OpenCode Adapter** at `~/projects/pai-opencode-adapter/`. The adapter wraps PAI without modifying it — this is by design (wrap, don't fork).
2. **Agent configuration changes** belong in `~/.config/opencode/agents/` (adapter-managed, not upstream PAI).
3. **Custom rules and instructions** belong in `~/.config/opencode/` (adapter-managed).
4. **User data** in `~/.claude/MEMORY/` and `~/.claude/PAI/USER/TELOS/` IS safe to modify — these are user-owned, not upstream-managed.

### If modification to PAI core is absolutely necessary:
- **STOP and ask the user first.** Explain:
  - "This change targets PAI core scaffolding (`~/.claude/PAI/`). If you pull a new version of PAI, this change will be lost."
  - "Would you like to proceed anyway, or should we implement this through the adapter instead?"
- **Never silently modify** PAI core files. Always get explicit confirmation.
- **Document the change** — if the user approves, note it so they know what to re-apply after an upstream pull.

### Safe to modify (user-owned):
- `~/.claude/MEMORY/` — Work PRDs, learning reflections, state
- `~/.claude/PAI/USER/TELOS/` — Goals, beliefs, challenges, identity
- `~/.config/opencode/` — OpenCode configuration, agents, themes, commands
- `~/projects/pai-opencode-adapter/` — The adapter itself
