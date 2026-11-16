# Notifications experience — disposable prototype

Decision ticket: [Prototype and choose the Notifications experience](https://github.com/rafalvu/cohort-005-project/issues/4).

**Awaiting human feedback. No design is chosen. Do not merge this branch.**

## Run and compare

From this worktree, run `npm run prototype:notifications`, then open:

- [A — Full page](http://127.0.0.1:5174/courses?variant=A): a dedicated destination reached from the sidebar; spacious scanning, then a linked-item view.
- [B — Side drawer](http://127.0.0.1:5174/courses?variant=B): keep the course catalogue beside the updates; trades context for narrower rows.
- [C — List + detail](http://127.0.0.1:5174/courses?variant=C): keep the list beside the selected item; trades space for fast review across multiple updates.

The floating bottom bar and left/right arrow keys switch variants. Arrow shortcuts leave input, select, textarea and editable controls alone. Below 1100px the split layout becomes a list-to-detail flow. Below 760px the sidebar becomes expandable navigation with a visible Notifications entry in the mobile bar. B becomes a full-width panel on mobile.

The prototype lives on the existing `/courses` route and keeps its loader and the app layout loader. Only a development build with `?variant=` renders it. The real Sidebar component and existing CSS tokens/Button are reused. The Notifications state, linked-item content and review account are synthetic. Catalogue data comes from a **copied local database**. Nothing subscribes to push, sends email, or writes notification records.

This local worktree shares installed dependencies via a node_modules symlink; Vite permits that resolved package directory. On this machine the packages are Apple Silicon builds: if an Intel Node is first on PATH, run `PATH=/opt/homebrew/bin:$PATH npm run prototype:notifications`. For another checkout, install the repo dependencies and prepare its normal local development database first.

## Suggested review

1. Compare A/B/C before changing state. Is Notifications easy to find without adding a global desktop header?
2. Open Maya’s question: its Notification becomes read, but it still awaits a staff reply. Open Sam’s request: its current decision is already made.
3. Use Mark as read and Mark all as read. Under **Show scenarios**, click **New update arrives** after mark-all: the new update remains unread.
4. Use the List state control for all-read, empty, loading and error. Error has a working retry. Check the long course/lesson text at the bottom of the list.
5. Open Preferences. Account-wide push starts off; questions, replies and new Refund Requests are enabled event defaults, while refund decisions and Seat claims start off. Enable push leads to a clearly labelled simulated browser handoff. Try denied, revoked, unavailable and Home Screen guidance states through scenarios.
6. Open a grouped push or refund email preview. Follow its link: saved read state stays unchanged. Try signed-out and unavailable link scenarios. The sign-in control is simulated and retains the linked item.
7. Remove access to a selected item: its Notification disappears from the list and unread count; the destination shows a generic unavailable message.

Existing refund email previews omit amounts, reasons and email addresses. Approval copy does not imply that money was returned. No new email types are proposed.

## Prototype limits

This demonstrates UX choices, not provider delivery, authentication, authorization enforcement, real deep-link routing, cross-device synchronization, expiry jobs or notification infrastructure. Link/session scenario controls affect the illustrated landing; they are not real account sessions. Destinations shown in disclosure panels are illustrative paths with synthetic IDs. Page reload resets all prototype state.

The copied catalogue’s links and existing Sidebar links still navigate the development app; they leave the prototype when the `variant` parameter is absent. Use the comparison URLs to return.

## Verification evidence

- TypeScript/type generation passed.
- Existing repository suite: 405 tests across 15 files passed. No prototype tests were added.
- Native Brave review: A at 390px; B and C at 1440px; A at the browser’s normal desktop size. Captures: [mobile](../../.impeccable/review/mobile.png) and [desktop](../../.impeccable/review/desktop.png).
- Browser interactions confirmed: read versus task state, already-decided Refund Request, explicit simulated permission handoff and denied recovery, external push preserving unread state, mark-all followed by a new unread update, and removing inaccessible content.
- Empty/loading/error and remaining permission/email cases are available for human review; they were inspected in source, not all exhaustively driven in the browser.
- Impeccable context/detector launcher could not execute (permission denied); incumbent source/tokens and screenshots were reviewed directly.

## Design boundary

Operate mode. Inherit Cadence’s neutral light/dark tokens, Inter, Lucide icons, modest radii and sidebar structure. No new visual identity or durable design-system change. The question is placement, scanning and navigation, with read state separate from current task state. The user confirmed mixed roles as the comparison baseline. A browser-owned permission prompt is illustrated, never imitated as an app-owned permission grant.

Incumbent comparison: `app/app.css` supplies the neutral semantic tokens and Inter stack; the existing Sidebar supplies Lucide icons, navigation spacing and active-state styling. The prototype extends those conventions with scoped notification layouts. Missing PRODUCT.md and DESIGN.md are outside this disposable comparison’s scope; this document records the local boundary without establishing a new system.

## Review disposition

**Ship for human prototype review.** This verdict makes A/B/C available for a human choice; it does not choose a design or approve production delivery. Nonblocking review notes: Browse Courses and Notifications can both appear active because the prototype uses `/courses`; the detail-context eyebrow remains a refinement opportunity. Neither should be interpreted as a durable navigation or typography decision.

Verification is limited to the evidence above. Full contrast and motion certification has not been performed. Keep these limitations attached to any handoff, and revisit them when implementing the selected experience.
