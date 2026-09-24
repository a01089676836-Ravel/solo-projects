---
name: runtime-maintenance
description: Maintain this manufacturing-agent-kit runtime when resuming project work, after Codex or model changes, or when its compatibility check requests review. Not a background monitor or an unrelated-project updater.
---

# Runtime maintenance

User authorization (2026-09-21): use Astra for the runtime and assess future model/Codex changes; implement necessary scoped updates and verify them. A release alone does not justify rewriting working code.

## On project resume

Run `npm.cmd run maintenance:check` from the project root once per session. It compares Node/Codex CLI versions and relevant file hashes with the last review. Seven days since the review also requests a fresh official-docs check. If the user reports a new model or Codex/app/tool change, review even when the offline check says current. The CLI version does not identify the desktop app or the active conversation model.

When review is required:

1. Read STATE.md and the current runtime config. Use openai-docs to search and open current official model guidance, deprecations and relevant Codex release notes. Record sources and date. The offline script cannot discover new releases or silent changes behind a model alias.
2. Compare API fields, structured-output schema, tool availability, timeout/token limits, credentials, skill instructions, and tests only where affected. Do not infer a regression or improvement from a version number.
3. Apply necessary backward-compatible code/skill/doc fixes within this project without re-requesting routine permission. Preserve unrelated work. Keep the user-selected Astra default unless a successor migration is actually justified. A new default with materially different cost, data destination or permissions requires reporting that consequence before activation. Never alter global Codex settings, install tools, run paid evaluations or schedule jobs merely because this skill exists.
4. Run relevant tests and the offline harness. A fixture PASS is not a live-model PASS. Run `agent:smoke` only when a live check is warranted and within the user's authorized API use; missing credentials are blocked, not success. Never print keys or read Codex login tokens as API credentials.
5. Write the decision, sources, actual checks and remaining limits in STATE.md and a review JSON with `sources`, `tests`, `decision`. Record it using `node tools/check-maintenance.mjs --record-review <review.json>` only after review. The command is bookkeeping, not automatic approval or validation. Failed checks remain unresolved in STATE.md; do not record them as completed maintenance.

Keep no-change decisions short. A model successor may be documented as a candidate without activating it. Preserve local state computation, reference checks, deterministic fallback, and explicit distinction between demo procedures and field-approved SOPs.

## Scope and triggers

AGENTS.md routes future Codex sessions here. `maintenance:check` is also available manually. No process runs when Codex is closed; no scheduled monitoring is installed. The runtime itself must not depend on online documentation checks. The existing runtime skills are app prompt modules, not automatically installed personal Codex skills.
