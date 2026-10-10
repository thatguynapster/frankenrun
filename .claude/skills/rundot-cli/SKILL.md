---
name: rundot-cli
description: Use the rundot CLI, RUN.world's command line — any command, flag, or --help question, a failing rundot CLI command, project setup, login and API keys, deploying/publishing/shipping a game build, generating assets from the CLI, and running paid Meta/Facebook ad campaigns.
---

# Use the rundot CLI

`rundot` is the RUN.world command line: it creates and configures a game,
uploads builds, publishes them, mints keys, generates assets, inspects player
data, and runs paid campaigns. This skill is the router — each area below has a
reference file with the commands and their verified flags.

## Three rules that apply to every command

1. **Confirm before you run.** `rundot <cmd> --help` prints the real flags for
   the version installed on this machine. Do that before running anything you
   haven't run in this session, and whenever a flag doesn't behave as expected.
2. **`--json` where it exists.** Several commands take `--json` and print one
   machine-readable line instead of the human summary. Prefer it when you're
   parsing output rather than showing it to the creator.
3. **Never invent a flag.** If `--help` doesn't list it, it doesn't exist —
   passing an unknown option fails the command. The same goes for commands: the
   references below cover what creators actually run, and `rundot --help` (or
   `rundot <group> --help`) is the source of truth for the rest.

## Where to look

| You want to… | Read |
|---|---|
| Deploy / ship / publish a build; a deploy that failed | [references/deploy.md](references/deploy.md), then [references/deploy-checklist.md](references/deploy-checklist.md) |
| Log in, start a project, mint or revoke API keys | [references/setup-and-auth.md](references/setup-and-auth.md) |
| Upload a build without deploying, list or re-point versions, flip public/private, move tags | [references/builds-and-versions.md](references/builds-and-versions.md) |
| Generate images, audio, video, text; see credits; list or delete generated assets | [references/generate-and-assets.md](references/generate-and-assets.md) |
| Inspect or repair a player's storage and files; look up a profile | [references/player-data.md](references/player-data.md) |
| Install or update RUN's skills for a coding agent; CLI hooks | [references/skills-and-agents.md](references/skills-and-agents.md) |
| Run a paid ad campaign (Meta / Google / Unity) — **beta** | [references/marketing.md](references/marketing.md) |
| A command failed, exit codes, env vars, where config lives | [references/troubleshooting.md](references/troubleshooting.md) |

## When this is not the right skill

- **Writing game code** — a save system, IAP shop, stats, tutorial, rewarded
  ads, notifications, localization, daily rewards or quests: the
  `rundot-feature-*` skills ship ready-made implementations.
- **How an SDK call behaves**, or fetching the full SDK docs: `rundot-sdk`.
- **Starting a game from nothing** (app shell, boot order, project skeleton):
  `rundot-new-game`.
- **Multiplayer netcode**: `rundot-multiplayer` (server-authoritative rooms) or
  `rundot-syncplay` (deterministic lockstep / rollback).
- **Pricing and economy design** for purchases or ads: `rundot-monetization-iap`
  and `rundot-monetization-ads`. Campaign timing and reading UA performance:
  `rundot-marketing-ua-analysis`. Organic promotion: `rundot-marketing-social`.

## Two things to know before your first command

- **Log in first.** Everything that touches the platform needs a session:
  `rundot login`. Headless/CI uses an `rk_` deploy key via
  `rundot login --api-key-stdin`.
- **Commands are game-scoped by the current directory.** `rundot init` writes
  `game.config.prod.json` in the project root, and later commands read the game
  id from it. Run them from the project root, or pass `--game-id`.

Some commands are beta and hidden unless `RUNDOT_BETA_FEATURES=1` is set — the
references say so where it applies. If a documented command isn't in `--help`,
it isn't enabled for this creator; say so rather than guessing.
