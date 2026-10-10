# When a command fails

## Read the error, then fix the cause

`rundot` names the cause in its output. Don't retry blindly, and don't reach for
a flag you haven't confirmed exists — re-run with `--help` first.

## Exit codes

- **`0`** — success. Note that some advisory output (update notices, the skills
  nudge) is printed on success paths and never changes the exit code.
- **`1`** — the command failed. Every unhandled error is caught and reported as
  `Failed to execute '<command path>'.` plus the exception type and message.

So a script can branch on zero / non-zero, but it should read the message (or
`--json`) for *why*.

## The `--json` envelope

Commands that take `--json` print one machine-readable line instead of the human
summary. Shapes differ per command family, but the contract is consistent:

- `rundot deploy --json` → `{"success":true,"gameId":…,"version":…,"shareUrl":…,"visibility":…}`,
  or `{"success":false,"error":"…"}` on failure (still exit 1).
- `rundot skills …  --json` → `{"ok":true,"items":[…]}` or `{"ok":false,"error":"…"}`.

`--json` also suppresses interactive prompts.

Separately, **destructive commands refuse to run when stdin isn't interactive**
— which is every coding agent's shell — unless you pass `--yes`. They fail with
`Confirmation required: re-run with --yes (stdin is not interactive).` and exit
1. `storage clear`, `storage import`, `files delete`, `files clear`,
`game api-keys revoke` and `skills uninstall` all behave this way (the storage
and files ones also accept `-y`). Passing `--yes` *is* the confirmation; only do
it when the creator asked for that exact destruction.

## Auth failures

1. `rundot whoami` — is there a session at all, and is it the identity you
   expect? For an API-key session it also prints the key type (`rk_` / `pk_`)
   and the game the key is confined to.
2. Re-authenticate with `rundot login` (or `rundot login --api-key-stdin` for
   headless).
3. A `pk_` playground key is rejected by every mutation and spend route by
   design. If a deploy or generate fails with a permissions error under a `pk_`
   session, you need an `rk_` deploy key, not a retry.
4. An API key is confined to one game. A request for a different `gameId` fails
   even with a valid key.

## Environment variables

| Variable | Effect |
|---|---|
| `RUNDOT_BETA_FEATURES=1` | Unhides beta command groups (`marketing`, `ugc`, `stats`, `collectibles`, …). Without it those commands don't exist as far as the parser is concerned. |
| `RUNDOT_SKIP_UPDATE_CHECK=1` | Suppresses the passive update check — no GitHub request, no notification. For headless callers (the check is unauthenticated and rate-limits on shared CI egress IPs). `rundot update` is unaffected. |
| `RUNDOT_SKILLS_NUDGE=0` | Silences the skills nudge. Accepts `0` or `false`. |
| `CI` (any non-empty value) | Also silences the skills nudge. |
| `RUNDOT_PLAYGROUND_KEY` | Read by the SDK's Vite plugin for headless playground sign-in. Written by `rundot playground grant-access` into `.env.local`. |
| `VENUS_INTERNAL_API_KEY` | Internal-admin surfaces only (`marketing ops`, `offerwall`). Not something a creator sets. |

## Where things live

**Per project** (in the game's directory):

- `game.config.prod.json` — the game id and build path `deploy` reads.
  The general form is `game.config.<env>.json`; `prod` is what creators use.
  A legacy `game.config.json` produces a warning, not silent success — run
  `rundot migrate-config` to move it forward.
- `rundot/` (legacy: `.rundot/`) — the project-local RUN folder. Reads prefer
  `rundot/` and fall back to `.rundot/`; writes always go to `rundot/`. Inside
  it: `skills/installed.json` (the skills ledger), `cli_hooks.json` (project
  hooks), `marketing/<name>/` (campaign folders).
- `.env.local` — the playground key. Git-ignored, `0600`. Never commit it.

**Per machine** (app data): `~/.rundot/` on macOS/Linux,
`%APPDATA%\.rundot\` on Windows — sessions (`*.session.json`), the global skills
ledger, and CLI-level config. Beta builds use `.rundot-beta/` instead, so a beta
CLI never reads a stable session.

## Commands that aren't there

If a command in these references isn't in `--help`:

1. It may be beta — check `RUNDOT_BETA_FEATURES`.
2. Your CLI may be older than the docs — `rundot update`.
3. It may be internal (`offerwall`, `marketing ops`) or Series-only.

In all three cases, tell the creator what's missing. Don't substitute a
different command and don't guess at flags.
