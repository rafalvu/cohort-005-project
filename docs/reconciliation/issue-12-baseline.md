# Reviewed baseline for issue #12

This records the prerequisite for [Notifications #11](https://github.com/rafalvu/cohort-005-project/issues/11), not implementation of that feature. Inventory refreshed 2026-11-17 before reconciliation; origin is `rafalvu/cohort-005-project`. Starting remote main: `22539a216cf8d3be8e11248848b2e1177420b58b`.

## Inventory and ancestry

The original `main` and `feature/language-unification` history has no merge-base with the course line rooted at `106f759`. Similar trees are not shared ancestry. The active course tree differs from remote main in only 58 paths; reconciliation copies the reviewed net changes onto main rather than merging unrelated histories or replaying intermediate service rewrites, screenshot workflows, mutation-test experiments and later reversions.

| Original local branch | Local tip | Remote tip | Disposition |
| --- | --- | --- | --- |
| `main` | `22539a216cf8d3be8e11248848b2e1177420b58b` | `22539a216cf8d3be8e11248848b2e1177420b58b` | Starting snapshot; accepted baseline will arrive through PRs. |
| `feature/language-unification` | `6e09775348225ea576a8d3bdd1a582e5a0c4500a` | `6e09775348225ea576a8d3bdd1a582e5a0c4500a` | Three commits over main; refund terminology/admin behavior superseded by the later reviewed application baseline. AppleDouble metadata was already removed by fc471c7; npm lock churn superseded by selected lockfile. |
| `pruning-glossary` | `7ba052444378ba8f514bb45507dc2ad0bdfeba6e` | `7ba052444378ba8f514bb45507dc2ad0bdfeba6e` | Retain concise business definitions; restore Student, Enrollment and Watch Limit needed by current spec; reconcile Team Admin and discussion terminology. |
| `pruning-adr` | `4c146b32fa76974214ac2c39a56285abb6a90390` | `4c146b32fa76974214ac2c39a56285abb6a90390` | Retain standards for money/formatting, colocated approval rationale and corrected purchase-country ADR. Combine with later full-price/unknown-country decision. |
| `wayfinder-skill` | `a1de0c78985e81d81497c25dcc5a48557d984137` | `979e28535d8b0ddd32b7241e51423c9a381879ad` | Same tip as remote add-wizard-skill, one ahead of its own remote. Retain planning skills and canonical Notification/Notifications meaning; simplify definitions. |
| `add-wizard-skill` | `4f2204b75fca94c13e9ce9d4cd16564ffc1147ea` | `a1de0c78985e81d81497c25dcc5a48557d984137` | Preserve checkout. Seven ahead/one behind remote at shared 979e285. Retain net application/skills/seed tool; replace Notification Feed terminology; removed research stays historical. |
| `prototype/notifications-experience` | `16ffaaa43a5f41b7f2776c7c2de2153707a33c78` | `16ffaaa43a5f41b7f2776c7c2de2153707a33c78` | Historical reference only: preserve chosen List + detail conclusion; exclude simulated UI/CSS, route/sidebar changes, Vite config, package scripts and screenshots. |
| `research/managed-notification-vendors` | `54d509349bededa5b2a70eef349037914da1c065` | `54d509349bededa5b2a70eef349037914da1c065` | Historical report only (54d5093); hosted/push vendor scope superseded by #11. No merge. |
| `research/onesignal-browser-binding` | `52631364eef66217dcbd4dffb51c9cb0714a2082` | `52631364eef66217dcbd4dffb51c9cb0714a2082` | Historical report only (5263136); browser push and binding excluded by #11. No merge. |

`origin/HEAD` points to `origin/main`. These are all original local branches and all eight remote branch refs (plus main); the two task branches `integration/issue-12-baseline` and `implement/issue-12-baseline` started at remote main. Reconciliation branches are task artifacts, not unaccounted prior work.

All course branches share the foundational course line through `093b039`. Glossary pruning branches there; ADR pruning branches at `42593ea`; the wizard, prototype, both research branches and remote terminology change share `979e285`. The application tree is identical across those later branches except the prototype overlay; ADR pruning changes only refund comments, not runtime behavior. No prototype/research runtime code is needed for the accepted baseline.

## Original worktrees and uncommitted work

All paths below are siblings under the original workspace. Preserve them and their branch tips:

| Worktree | Branch | Initial status |
| --- | --- | --- |
| `cohort-005-project` | `add-wizard-skill` | Clean |
| `cohort-005-managed-notification-research` | `research/managed-notification-vendors` | Clean |
| `cohort-005-notifications-prototype` | `prototype/notifications-experience` | Staged `.impeccable/review/._desktop.png`, `.impeccable/review/._mobile.png`, and `node_modules` symlink; left untouched |
| `cohort-005-onesignal-binding-research` | `research/onesignal-browser-binding` | Clean |

The dedicated `cohort-005-issue-12-baseline` worktree was clean on creation at `22539a2`. Its generated database and dependency symlink are local verification artifacts, not source changes.

## Lasting changes by area

- **Application:** retain the active tree's refund request/decision service, admin route/sidebar entry, purchase/settings/team/Seat and instructor entitlement handling, enrollment count, country fallback, mail transport/outbox, and existing tests. Main already contains the broad course/tooling foundation; only net differences are imported. Older `feature/language-unification` request tables/migration naming and implementation are superseded, not replayed alongside the newer migration lineage.
- **Schema and seed:** retain `0010_cuddly_red_skull`, `0011_volatile_sasquatch`, their snapshots/journal and matching seed/schema. Existing refund tests migrate real SQLite databases. No Notification storage or historical backfill is introduced.
- **Tooling:** retain ai-hero-cli 0.13.0 package/lock update, LF attributes and local outbox ignore rule. Preserve the existing main skill versions where identical to the active tree. Add domain-modeling, grill-with-docs, prototype, research, wayfinder and wizard skills (including supporting formats/templates/agent metadata); retain the Wayfinder seed script and package command without executing its GitHub mutation workflow.
- **ADR pruning:** retain progress preservation (0001), whole Team Licence refunds (0003), independent Enrollment (0004), one SQLite/Drizzle database owner (0006), clarified purchase country (0009), and unknown-country full price (0012). Move 0002 approval timing rationale beside `approveRefundRequest`; move 0005 money rules to coding standards. Removed 0007 icon choice and 0011 formatter ADR were conventions, not lasting decisions; formatter rule survives in standards. Old 0008 IP lookup and 0010 server-log email ADRs are superseded by current country behavior and MailTransport.
- **Glossary:** combine concise pruning with Student, Enrollment, Watch Limit, Discussion Question/Reply and Notification/Notifications. Team Admin is a team responsibility, not necessarily the Purchase buyer. Discussion Questions include staff-authored top-level contributions; peer replies do not imply a resolved task. Definitions contain domain meaning only; storage, read actions and delivery details stay in the specification.
- **Historical research:** course commits `8c6a0e9` and `2a5779a` were intentionally removed by `5dbaf4d`; do not resurrect them. Dedicated research branches and their reports remain available at the tips above. Their push/vendor conclusions are superseded by the final reduced architecture.
- **Historical prototype:** preserve commits `64b09d1` and `16ffaaa` in their branch. Lasting decision is List + detail, sidebar count and responsive sequential detail navigation. Correct dual-active sidebar/context placement in future implementation. Prototype push controls, simulated data and route shortcuts are not production requirements.

## Accepted decision pointers

[Specification #11](https://github.com/rafalvu/cohort-005-project/issues/11) is authoritative over older comments. It consolidates [event recipients #2](https://github.com/rafalvu/cohort-005-project/issues/2), [lifecycle #3](https://github.com/rafalvu/cohort-005-project/issues/3), [UI choice #4](https://github.com/rafalvu/cohort-005-project/issues/4), [architecture #5](https://github.com/rafalvu/cohort-005-project/issues/5), [release sequence #6](https://github.com/rafalvu/cohort-005-project/issues/6), and [channel scope #8](https://github.com/rafalvu/cohort-005-project/issues/8). Closed decision issues are not proof of merged implementation. Browser push, new email categories, production provisioning and the Notifications feature itself remain outside this baseline.

## Reviews and verification

Application scope: commits `1738600` and `6c4c730`. Parallel Standards and Spec review: Spec reported no findings; Standards reported one hard finding (two admin action failure returns) and two heuristics (duplicated Email type and Seat messages). Resolved all three; follow-up Standards review confirmed no findings. Admin failures now use the existing ErrorBoundary with string data; successful fetcher feedback remains.

Checks in the dedicated worktree: `npm run typecheck` passed, then `npm run test` passed 405 tests across 15 files. `npm run db:seed` successfully replayed migrations and populated the isolated database. ARM Node (`PATH=/opt/homebrew/bin:$PATH`) matches existing native dependencies. Initial x64 Node failed to load optional Rollup; initial sandbox run blocked an existing local-socket test and tsx IPC. Escalated reruns passed; these were environment restrictions, not waived test failures.

Existing email wording/privacy, transport failure presentation and production token fallback remain known #11 later-slice work. This baseline is not a production-readiness claim. No production data was seeded or changed.

Documentation scope and final main revision are recorded in the completion record after reviewed merges.
