---
description: Upgrade PAI from upstream — fetch, diff, backup, pull, sync, and check adapter compatibility.
agent: native
---

Run the PAI upgrade workflow. This checks the upstream PAI repository for changes, syncs them to the local installation, and verifies adapter compatibility.

## What This Does

1. **Fetch** — `git fetch origin` in `~/.claude/Personal_AI_Infrastructure/`
2. **Check** — Compare local HEAD vs `origin/main`. If already up to date, stop early.
3. **Diff** — Categorize changed files by domain (algorithm, hooks, skills, tools, settings, context)
4. **Backup** — Snapshot `~/.claude/PAI/` to `~/.claude/PAI.backup-{timestamp}/`
5. **Pull** — `git pull origin main` to update the local clone
6. **Sync** — Copy updated files from repo clone → `~/.claude/PAI/` (preserves `USER/` and `MEMORY/` — never overwrites user data)
7. **Compatibility** — Check if the `pai-opencode-adapter` needs changes for the new PAI version
8. **Verify** — Report results

## Usage

```
/upgrade           # Full upgrade
/upgrade --dry-run # Preview what would change without modifying anything
```

## If Adapter Needs Updates

When the compatibility check finds breaking changes, the report will list which adapter files are affected. At that point:
1. Create a branch in the adapter repo
2. Fix the affected files
3. Run `bun test` to verify
4. Create a PR for review

## Prerequisites

- `~/.claude/Personal_AI_Infrastructure/` must exist as a git clone of the upstream PAI repo
- If it doesn't exist: `git clone https://github.com/danielmiessler/Personal_AI_Infrastructure ~/.claude/Personal_AI_Infrastructure`

$ARGUMENTS
