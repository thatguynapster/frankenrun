# Skills and coding agents

RUN's skills (guides like this one) ship **embedded in the `rundot` binary**, so
there's nothing to fetch and no separate version to track: `rundot update`
updates the skills along with the CLI.

## Install them

```bash
rundot ai setup            # detect the agents in use, confirm, install everything
rundot ai setup --yes      # install without prompting
```

`ai setup` detects agents from `.claude/`, `.agents/`, `.cursor/`, `.pi/`, or a
`CLAUDE.md`, and falls back to Claude when nothing is detected. It installs the
whole catalog at project scope. Flags: `--yes`, `--json`.

## Finer control

| Command | What it does |
|---|---|
| `rundot skills list` | Every available skill and, per agent, its state for the scope: `not-installed`, `installed`, `needs-update`, or `modified`. |
| `rundot skills install [skill]` | Install one skill, or all when the name is omitted. |
| `rundot skills update [skill]` | Re-install the embedded version over what's already tracked. Never adds new skills. |
| `rundot skills uninstall [skill]` | Remove tracked skill files. |

Shared flags: `--agent <id>` (repeatable — `claude`, `codex`, `cursor`, `pi`),
`--scope project|user`, `--json`. `install`/`update`/`uninstall` also take
`--force`; `uninstall` takes `--yes`.

```bash
rundot skills install rundot-cli --agent cursor --agent claude
rundot skills list --scope user --json
rundot skills update --force            # take the embedded version everywhere
rundot skills uninstall rundot-cli --agent claude --yes
```

## The ledger, and why your edits survive

Install copies each skill's files into the agent's skills directory
(`.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.pi/skills/`) and
records a SHA-256 of every file it wrote in `rundot/skills/installed.json`.
That ledger is what makes updates safe:

- A tracked file whose bytes still match the ledger is **rundot's** — an update
  overwrites it with the new embedded version.
- A tracked file you edited, or an untracked file that would be overwritten, is
  **preserved**. `skills update` shows you the diff and keeps your version unless
  you approve the overwrite (interactive) or pass `--force`.
- A tracked file you **deleted** stays deleted. That choice is honored on every
  later install, so a skill you don't want doesn't come back — except under
  `--force`.
- `uninstall` deletes only files whose SHA still matches the ledger, so it never
  eats your edits either (again, unless `--force`).

**`--force` discards local edits.** Don't reach for it to make an error go away;
read what was preserved and merge by hand instead.

## Retired skills

When RUN retires a skill, `ai setup`, `skills install`, `skills update` — and the
nudge below, on its next scan — clean it up for you: the retired skill's files
are removed the same edit-preserving way `uninstall` works, and you'll see
`Removed N retired RUN skill(s).` Files you edited are left on disk.

## The nudge

Inside a RUN project, some commands print a short advisory line — skills not
installed, skills silently updated to match the CLI, edited skills with a new
upstream version pending review, or new catalog skills available. It's advisory
only and never fails your command. Silence it with `RUNDOT_SKILLS_NUDGE=0`
(it's already suppressed under `--json` and in CI).

## CLI hooks

`rundot/cli_hooks.json` (legacy: `.rundot/cli_hooks.json`) lets a project run its
own commands around `rundot` commands. The SDK's `npx rundot-sdk-setup -y`
creates it as one of its consented writes. It's per-project config, not
per-machine — treat adding a hook as a change to the repo.
