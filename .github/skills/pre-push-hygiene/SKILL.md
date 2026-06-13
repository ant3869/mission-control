# Pre-Push Hygiene

A comprehensive pre-push checklist for nexus-command: version bump, changelog, README sync, temp-file cleanup, secrets scan, and .gitignore hygiene. Run before every `git push` to keep the repo clean.

---

## What This Skill Does

1. **Detects the current version** from `package.json`
2. **Bumps the patch version** (or asks the user for a different semver component)
3. **Writes a CHANGELOG entry** for the new version
4. **Updates the README** feature table for any changed views
5. **Scans for exposed secrets** in tracked files
6. **Finds and untracked temp/scratch files** left in the working tree
7. **Updates `.gitignore`** so those files never come back
8. **Commits all hygiene changes** under a `chore:` message
9. **Reports a push-ready summary**

---

## Process

### Step 1 — Assess the changeset

```bash
git diff HEAD --stat
git log --oneline -5
```

Read what changed. Identify: which views were modified, whether any new data shapes or API routes were added, and whether any temp files were accidentally staged.

### Step 2 — Determine next version

Read `package.json` for the current version string.

- **Patch** (`x.y.Z+1`): bug fixes, layout tweaks, copy changes, dependency bumps
- **Minor** (`x.Y+1.0`): new feature, new view, new API endpoint
- **Major** (`X+1.0.0`): breaking change, full redesign, removed API

Default to **patch** unless the changeset clearly warrants minor or major. Ask the user only if ambiguous.

### Step 3 — Bump `package.json`

Edit `package.json` `"version"` field to the new version. The Vite config reads this automatically (`__APP_VERSION__` in the sidebar) so no other code change is needed.

### Step 4 — Write CHANGELOG entry

Prepend to `CHANGELOG.md` immediately after the `---` separator line and before the previous `## [x.y.z]` entry:

```markdown
## [NEW_VERSION] — YYYY-MM-DD

### Added
- **Feature name** — 1–2 sentence description. Include where in the UI it lives.

### Changed
- **What changed** — brief, user-facing description of the behavioral or visual change.

### Fixed
- **Bug fixed** — what was broken and what it does now.

### Removed
- **What was removed** — only if applicable.
```

Only include sections that have content. Keep each bullet to 1–3 lines.

### Step 5 — Update README

Open `README.md` and find the view table(s). For every view that was materially changed:
- Add a sentence or clause to its table cell describing the new capability
- Do **not** rewrite the whole cell — append or amend concisely

If a brand-new view was added, add a new row to the appropriate table section.

### Step 6 — Secrets scan

```bash
git grep -i "api.key\|apikey\|api_key\|secret\|bearer.*=\|password.*=" \
  -- ":(exclude)node_modules" ":(exclude)*.lock" ":(exclude)package.json" \
  | grep -v "process\.env\|import\.\|YOUR_\|example\|placeholder\|TODO"
```

If any hits look like real credentials (long opaque strings, not env-var references):
- Remove the secret from the file immediately
- Add the file to `.gitignore` if it is a config/data file that shouldn't be tracked
- If the secret was ever committed (even in a previous commit), tell the user to rotate it

### Step 7 — Temp/scratch file cleanup

Look for files that shouldn't be in the repo:

```bash
# Untracked files that look like temp/debug artifacts
git status --short | grep "^??" | grep -E "\.(mjs|js|log|tmp)$|__[^/]"

# Tracked files with suspicious names
git ls-files | grep -E "^__|\.log$|\.tmp$|scratch|test-[0-9]"

# Large binary blobs that shouldn't be public assets
git ls-files public/ | grep -vE "\.(ico|svg|webp|gif|woff2?|ttf)$|icon\."
```

For each suspicious file:
1. If it's a genuine temp/debug file → `git rm --cached <file>` and add to `.gitignore`
2. If it's a real asset that should be tracked → leave it alone
3. If it's a data file with secrets → `git rm --cached` + `.gitignore` + rotate credentials

### Step 8 — Update `.gitignore`

After `git rm --cached` any files, add the appropriate patterns to `.gitignore` under the right section:

| File type | Section to add to |
|-----------|-------------------|
| `__*.mjs`, `__*.js` debug scripts | `# ─── Temporary / debug scripts` |
| Screenshot PNGs dropped in `public/` | `# ─── Screenshot / dropped images` |
| New runtime data files | `# ─── Runtime personal data` |
| New env file variants | `# ─── Environment / Secrets` |

### Step 9 — Commit hygiene changes

Stage only the hygiene files:

```bash
git add package.json CHANGELOG.md README.md .gitignore
```

If any files were `git rm --cached`, they are already staged.

Commit with:

```
chore: v{NEW_VERSION} — pre-push hygiene

- Bump version {OLD} → {NEW}
- Add CHANGELOG entry for v{NEW}
- Update README for changed views
- Untrack temp files: __trace.mjs, public/screenshots
- Extend .gitignore: __*.mjs, dropped public PNGs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Step 10 — Final check

```bash
git status           # should be clean
git log --oneline -3 # should show both the feature commit and the hygiene commit
git diff origin/main --stat  # everything you're about to push
```

Report to the user:
- New version number
- What was cleaned up
- Confirm no secrets found
- Confirm working tree is clean
- Prompt: "Ready to push — `git push`?"

---

## Quick-Run Checklist (copy-paste reminder)

```
[ ] package.json version bumped
[ ] CHANGELOG entry written
[ ] README updated for changed views
[ ] Secrets scan clean
[ ] Temp files untracked + gitignored
[ ] Hygiene commit made
[ ] git status clean
[ ] git log looks right
[ ] Ready to push
```

---

## Invoke this skill

Type `/pre-push-hygiene` in Claude Code to run this checklist automatically.
