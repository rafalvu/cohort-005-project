# Managed notification vendors for Cadence

Research date: **2026-11-13**. Public primary sources checked on that date; prices are USD per month before taxes. Research only: no accounts, purchases, credentials, messages, or production integrations were created. Traffic, budget, and the scope of email migration remain unknown.

## Decision supported by this research

Two architectures merit evaluation. **Knock is the stronger candidate when hosted inbox storage and orchestration are priorities. OneSignal plus Postmark is a narrower transport combination and leaves the inbox and reliable event handoff to Cadence.** This is an architectural assessment, not a vendor selection. Knock documents a hosted real-time feed and workflows; OneSignal explicitly says an individual user's notification history must be stored by the application. [Knock concepts](https://docs.knock.app/getting-started/what-is-knock), [OneSignal activity feed](https://documentation.onesignal.com/docs/en/create-an-activity-feed).

There is a material browser identity blocker for **both** options if OneSignal carries personal push notifications: its current JWT identity verification does **not** support the Web SDK. A routine `login(userId)` integration is not adequate proof that the browser owns that user's identity. Obtain a supported secure web association design or reconsider the push provider before production. [OneSignal identity verification](https://documentation.onesignal.com/docs/en/identity-verification).

The requirement against self-hosted notification workers/servers rules out casually filling gaps with a background poller. App-owned inbox storage can fit the existing application, but reliable asynchronous delivery still requires an explicitly chosen managed queue/orchestrator and recovery design. That service and its cost are not selected here. Neither vendor's downstream retries solve a database commit that never reaches the vendor; this follows from the boundary between the application transaction and the vendors' accepted API requests. [Knock delivery pipeline](https://docs.knock.app/send-notifications/delivering-notifications), [OneSignal request idempotency](https://documentation.onesignal.com/reference/idempotent-notification-requests).

## Existing application evidence

These findings come from the repository, not vendor promises:

- [mailer.server.ts](../../app/lib/mailer.server.ts) sends plain-text email directly to Postmark's `/email` API with `POSTMARK_SERVER_TOKEN`, the `outbound` message stream, and a fixed `Cadence <hello@cadence.dev>` sender. Without the token it writes JSON files to `.outbox/`. The transport has no durable production queue, retry policy, or persisted provider message ID; the filesystem fallback is a development transport, not a delivery queue.
- [layout.app.tsx](../../app/routes/layout.app.tsx) loads `currentUser`, renders the sidebar and nested routes, and already hosts Sonner toasts. A shared notification bell/provider could attach here; an ephemeral toast is not a persistent inbox.
- [root.tsx](../../app/root.tsx) provides the React Router document shell and scripts. It currently supplies no manifest link. Web push SDK initialization and public service-worker/manifest assets would require implementation and SSR-safe integration.
- [session.ts](../../app/lib/session.ts) reads a numeric user ID from a development cookie with a hardcoded development secret. The layout includes a development user selector. Production notification tokens must derive from trusted production authentication, not this development identity mechanism.

No application behavior is changed by this report.

## Shortlist and responsibility boundaries

| Option | Hosted responsibilities | Cadence responsibilities | Assessment |
| --- | --- | --- | --- |
| A. Knock inbox/orchestration + Postmark email + OneSignal push | Knock stores feed items, exposes React UI/feed APIs, coordinates channel steps and preferences. Postmark sends email; OneSignal handles web push delivery infrastructure. | Trusted identity, event creation and reliable handoff, UI integration, permission UX, deletion/export policy, vendor configuration and monitoring. | Best fit to investigate when avoiding an owned notification backend is the main goal. Additional vendor cost and workflow/feed coupling. |
| B. OneSignal push + existing Postmark + app-owned inbox | Managed push and email transports. | Inbox schema/API/UI, unread/read state, retention/export, per-event preferences, channel fan-out, duplicate handling and a managed handoff/recovery mechanism. | Potentially lower vendor fees, but greater application responsibility. Incomplete as a durable architecture until managed orchestration/queue is specified. |

Sources for responsibilities: [Knock overview](https://docs.knock.app/getting-started/what-is-knock), [Knock Postmark integration](https://docs.knock.app/integrations/email/postmark), [Knock OneSignal integration](https://docs.knock.app/integrations/push/one-signal), [OneSignal activity feed](https://documentation.onesignal.com/docs/en/create-an-activity-feed).

OneSignal's advertised “in-app messaging” should not be mistaken for the required persistent web inbox. Its activity-feed guidance requires application storage. Do not populate an inbox exclusively from push receipt callbacks: users who declined push still need their in-app history, and callback support varies by browser. Prefer a domain-event-driven inbox entry independent of optional channel delivery. The latter is a design recommendation based on those limitations. [Activity feed](https://documentation.onesignal.com/docs/en/create-an-activity-feed), [Browser callback support](https://documentation.onesignal.com/docs/en/webhooks).

Knock's OneSignal adapter uses the Knock user ID as OneSignal's external ID and supports payload overrides; its documentation is framed as mobile push. OneSignal independently supports web push. Therefore the combined **browser** path is a plausible candidate, not a proven Cadence integration: verify browser subscriptions, web click URLs, payloads, and identity protection in a spike. Do not assume adding Knock removes OneSignal's web identity limitation. [Adapter targeting](https://docs.knock.app/integrations/push/one-signal), [Web push setup](https://documentation.onesignal.com/docs/en/web-push-setup).

## Browser support, consent, and timing

| Surface | Verified behavior and consequence |
| --- | --- |
| Desktop web | OneSignal supports Chrome, Firefox, Safari and Edge. HTTPS, a same-origin service worker and notification permission are required. Private/incognito subscription is unsupported. [Setup](https://documentation.onesignal.com/docs/en/web-push-setup). |
| Android web | Supported browsers can receive web push; background/process and OS settings still affect reception. Test actual supported Android browsers and device states. [Browser behavior](https://documentation.onesignal.com/docs/en/browser-behavior-and-unsubscribes). |
| iPhone/iPad | iOS/iPadOS 16.4+ requires opening the site as a Home Screen web app and tapping a subscribe control there. A normal Safari/Chrome/Edge/Firefox tab cannot request permission. Keep a manifest with `display: standalone` for older supported versions; iOS 26 defaults Home Screen additions to web apps unless the user turns that off. [iOS setup](https://documentation.onesignal.com/docs/en/web-push-for-ios). |
| Browser closed/offline | Behavior depends on browser, running background processes, OS, network and expiry. The vendor's browser table and Firefox explanatory text are not fully consistent; validate the supported matrix instead of promising delivery while closed. [Browser behavior](https://documentation.onesignal.com/docs/en/browser-behavior-and-unsubscribes). |

**No subminute browser-push guarantee is justified.** A roughly one-minute target can describe online in-app freshness, with reconnection/refetch behavior, not OS display time. Knock's real-time feed is an implementation aid; neither a hosted feed nor API acceptance proves the user saw an OS notification. Safari also lacks OneSignal confirmed receipt in the documented React integration. [Knock feed](https://docs.knock.app/in-app-ui/react/feed), [OneSignal React setup](https://documentation.onesignal.com/docs/en/react-js-setup).

Permission UX should explain value and request consent after an intentional action, provide a denied/unsupported state, and preserve the in-app inbox when push is unavailable. For iOS show Home Screen instructions before prompting. OneSignal still requires its service worker; only one worker controls a scope, so inspect any existing PWA worker before installation. A browser service worker is a client requirement, distinct from operating a self-hosted notification server. [Permission setup](https://documentation.onesignal.com/docs/en/web-push-setup), [iOS worker and gesture requirements](https://documentation.onesignal.com/docs/en/web-push-for-ios).

## Identity, authorization, and preferences

**Knock:** enable enhanced security before production. It is off by default, when a public key can act as arbitrary users. Sign short-lived user JWTs on the authenticated backend, keep signing/private API keys server-side, handle expiry, and scope any object grants to authorized resources. A user ID from a request body or the current development selector is not an authentication proof. [Knock security](https://docs.knock.app/in-app-ui/security-and-authentication).

**OneSignal:** JWT verification currently supports native Android/iOS only. Enabling its app-wide toggle breaks unsupported clients' user/subscription operations. Unverified clients knowing an external ID can impersonate it. A server-held send key does not prove browser ownership. Secure binding and shared-device logout behavior are production acceptance gates. [Identity verification](https://documentation.onesignal.com/docs/en/identity-verification).

**Preference model:** Knock provides channel/workflow/category preferences and a React `usePreferences` hook. OneSignal offers subscription enable/disable APIs and tags for topic/frequency rules, while the preference-center UI and use of those rules are application work. Browser permission and product preferences are separate controls: granting permission must not override a product opt-out. Determine whether a setting applies to one device or all a user's devices, and test logout/account switching. [Knock preferences UI](https://docs.knock.app/in-app-ui/react/headless/preferences), [OneSignal preference center](https://documentation.onesignal.com/docs/en/preference-center).

For email, preserve Postmark bounce/unsubscribe suppressions and decide explicitly which notification classes are optional. Do not silently move existing transactional refund mail into a new preference policy. Postmark separates transactional and broadcast streams; this report does not decide whether existing email remains direct or moves behind Knock. [Postmark stream/pricing explanation](https://www.postmarkapp.com/pricing), [Postmark subscription-change webhook](https://postmarkapp.com/developer/webhooks/subscription-change-webhook).

## Reliability and observability

| Concern | Verified capability | Required application decision |
| --- | --- | --- |
| Knock send retries | Up to eight retries over 30 minutes for transient/retryable provider failures; distinct queued, attempted, bounced and undelivered states. Status-check retries are separate. [Delivery](https://docs.knock.app/send-notifications/delivering-notifications). | Decide failure alerting and replay; do not retry permanent errors forever. |
| Knock trigger deduplication | `Idempotency-Key` supported on workflow trigger, with a 24-hour default window; not automatically effective on other endpoints. [API overview](https://docs.knock.app/api-reference/overview). | Persist stable event/channel operation identifiers; define behavior after deduplication expiry. |
| OneSignal request deduplication | Message creation accepts `idempotency_key` UUIDs retained for 30 days. This guarantees at-most-once processing within its scope, not delivery. [Idempotency](https://documentation.onesignal.com/reference/idempotent-notification-requests). | Reuse the same key for retries of the same operation and respect retry responses. |
| Postmark sending | No idempotency-key feature currently documented as supported. [Postmark support](https://postmarkapp.com/support/article/what-is-an-idempotency-key). | Handle ambiguous timeouts and reconcile message IDs; neither direct retries nor an orchestrator justify an exactly-once email promise. |
| Knock outbound webhooks | Retries eligible non-2xx failures, excludes several permanent 4xx/redirect responses; retry timing is not a fixed contractual schedule. [Webhooks](https://docs.knock.app/developer-tools/outbound-webhooks/overview). | Authenticate, deduplicate and durably record incoming events before acknowledging. |
| OneSignal events | Event Streams is the recommended server integration; browser push callbacks are client-originated and unsupported on Safari. Streams retry recoverable failures and may disable after sustained failures; deduplicate using `event.id`. [Web callbacks](https://documentation.onesignal.com/docs/en/webhooks), [Event Streams](https://documentation.onesignal.com/docs/en/event-streams). | Monitor stream disablement; don't treat callbacks as authorization or the authoritative inbox. |
| Postmark webhooks | Delivery, bounce and subscription events are available; retries mean duplicates are possible. Protection supports HTTP Basic Auth and IP restrictions. [Webhooks](https://postmarkapp.com/developer/webhooks/webhooks-overview). | Persist distinct event identities, not merely one flag for all events on a message; return success after durable acceptance. |

Proposed invariant: commit the business change and notification intent consistently, then hand the intent to a managed delivery system with recorded acceptance and replay. The existing request-time `sendEmail` function does not provide that invariant. Select the managed handoff mechanism before calling either option production-ready; no custom continuously running worker is recommended here. Vendor retries begin only after the relevant service has received the operation. [Local transport](../../app/lib/mailer.server.ts), [Knock delivery](https://docs.knock.app/send-notifications/delivering-notifications).

## Retention, deletion, export, and portability

| Data | Verified policy/capability | Implication |
| --- | --- | --- |
| Knock persistent inbox | Feed items remain available indefinitely even when operational logs expire. [Retention](https://docs.knock.app/manage-your-account/data-retention). | Suitable for persistent history; choose a product retention policy instead of treating defaults as a requirement. |
| Knock operational logs | Non-Enterprise logs generally 30 days; Enterprise 90 days; API logs 30 days universally. Retention docs say custom retention windows are unsupported; pricing separately describes configurable feed retention. [Retention](https://docs.knock.app/manage-your-account/data-retention), [Pricing](https://knock.app/pricing). | Feed storage and debug logs are different. Confirm exact feed-expiry controls if required; never claim configurable operational retention. |
| Knock deletion/export | User deletion removes properties, preferences, channel data, subscriptions, schedules and associated messages/activity; may take up to 10 minutes. Feed API remains usable for older feed items. [Deletion](https://docs.knock.app/managing-recipients/deleting-users), [Retention](https://docs.knock.app/manage-your-account/data-retention). | Build/export-test pagination and read-state mapping; no complete one-click migration guarantee was verified. Delete copies in downstream providers separately. |
| OneSignal history/export | API messages and audience activity available approximately 30 days. Paid user/subscription data lasts for the app lifetime; Free inactive data is deleted after 18 months. CSV/API exports exist; subscription exports omit users without subscriptions. [Exporting data](https://documentation.onesignal.com/docs/en/exporting-data). | Transport reports are not a permanent per-user inbox. Own inbox history in option B. |
| OneSignal deletion | Delete-user API removes the user, associated properties, subscriptions and identity. [Delete user](https://documentation.onesignal.com/reference/delete-user). | Coordinate deletion with Cadence and prevent unintended recreation by an active client. |
| Postmark data | Basic advertises 45-day retention; Pro supports configurable retention up to 365 days, default 45. Recipient-data removal API requires support enablement and account privileges. [Pricing](https://www.postmarkapp.com/pricing), [Data removal](https://postmarkapp.com/developer/api/data-removals-api). | Email operational data is not inbox storage. Confirm deletion access and chosen retention before rollout. |

Lock-in assessment: Knock concentrates feed IDs, status semantics, preferences, workflow definitions and templates in its model. A headless React UI reduces component coupling, not data/workflow migration work. Option B keeps inbox rows portable but retains OneSignal subscription/origin dependence. Exportable push-token records alone do not prove another provider can reuse web subscriptions; VAPID keys, original origin, worker updates and provider support require a migration proof. Preserve neutral domain-event IDs and click destinations in Cadence, and test exports before commitment. These are engineering implications, not vendor guarantees. [Knock headless UI](https://docs.knock.app/in-app-ui/react/overview), [OneSignal exports](https://documentation.onesignal.com/docs/en/exporting-data), [OneSignal iOS/VAPID requirements](https://documentation.onesignal.com/docs/en/web-push-for-ios).

## Public prices and explicit illustrative scenarios

| Vendor | Relevant public rate checked 2026-11-13 |
| --- | --- |
| Knock | Free: 10,000 messages/month. Starter: $250/month including 50,000; then $0.005/message. Each recipient/channel delivery counts separately. Downstream providers are billed separately. [Pricing](https://knock.app/pricing). |
| OneSignal | Free web push: maximum 10,000 subscribers per send. Growth: $19/month plus $0.004/web push subscriber, unlimited sends. Count browser/device subscriptions, not necessarily people. [Pricing](https://onesignal.com/pricing). |
| Postmark | Free developer: 100 emails/month. At 10,000 monthly emails, Basic $15 plus $1.80/1,000 extra; Pro $16.50 plus $1.30/1,000 extra. [Pricing](https://www.postmarkapp.com/pricing). |

Calculations below are illustrative vendor-fee subtotals, not a traffic forecast or plan recommendation. Assume one inbox item and one push per recipient-event, optional email as specified, no batching, all channels successfully sent, and OneSignal Growth for paid scenarios. Postmark Basic is used only as a consistent arithmetic baseline. No new email scope is implied.

| Scenario | Assumptions/month | A: Knock + push + email | B: push + email, app-owned inbox |
| --- | --- | --- | --- |
| Small paid push pilot | 1,000 web subscriptions; 4,000 recipient-events; 1,000 emails; Knock messages = 4,000 + 4,000 + 1,000 = 9,000 | $0 + ($19 + $4) + $15 = **$38** | **$38** plus inbox and managed handoff costs |
| Growing usage | 5,000 web subscriptions; 20,000 recipient-events; 10,000 emails; Knock messages = 50,000 | $250 + ($19 + $20) + $15 = **$304** | **$54** plus inbox and managed handoff costs |
| More frequent notices | 10,000 web subscriptions; 50,000 recipient-events; 10,000 emails; Knock messages = 110,000 | ($250 + 60,000 × $0.005) + ($19 + $40) + $15 = **$624** | **$74** plus inbox and managed handoff costs |

Arithmetic uses the linked vendor rates above. Free OneSignal could reduce these subtotals if its feature and per-send limits suffice; it is not assumed to be equivalent to Growth. Existing Postmark spend may already cover incremental email volume, so full invoice subtotal and incremental cost differ. Excluded: tax, currency conversion, engineering/support, database/storage, managed queue/orchestration, premium features and extra observability. OneSignal Event Streams specifically lists Free 1,000 events/month and Growth 10,000; a delivery/click stream can exceed those even when push sending fits. Do not assume unlimited event export at the push rate. [OneSignal pricing](https://onesignal.com/pricing), [Event Streams limits](https://documentation.onesignal.com/docs/en/event-streams).

## React Router integration outline and validation gates

This is a proposed implementation outline, not completed integration:

1. Establish production authentication. Server loaders may issue authorized Knock tokens; private signing/API keys never enter browser bundles. Do not release personal browser push until the OneSignal web binding issue is resolved. [Knock security](https://docs.knock.app/in-app-ui/security-and-authentication), [OneSignal identity](https://documentation.onesignal.com/docs/en/identity-verification).
2. For A, mount Knock providers near the authenticated application layout and add a feed bell/inbox. Choose unread versus unseen semantics deliberately; the prebuilt popover normally marks items seen when opened. For B, implement authorized inbox loaders/actions and foreground refresh against application storage. The latter is a design inference. [Knock React feed](https://docs.knock.app/in-app-ui/react/feed), [Local layout](../../app/routes/layout.app.tsx).
3. Initialize OneSignal once on the client, serve a public JavaScript worker at a stable path, and add the manifest/icons needed for mobile web. Its React documentation provides browser-only initialization; adapt this to React Router SSR and route transitions, rather than assuming a Next.js example drops in unchanged. [React setup](https://documentation.onesignal.com/docs/en/react-js-setup), [Local document shell](../../app/root.tsx).
4. Add a managed durable event handoff, stable event IDs, deduplicated webhook ingestion and operational failure reporting. Test crash/timeout between domain commit and vendor acceptance, duplicates, permanent errors and provider downtime. [Idempotency scope](https://docs.knock.app/api-reference/overview), [OneSignal deduplication](https://documentation.onesignal.com/reference/idempotent-notification-requests).
5. Test two different users, multiple tabs/devices, logout and account switching, expired tokens, denied/revoked permission, unsupported/private mode, offline/reconnect, iOS Home Screen installation, existing-worker coexistence and deletion/export. Verify link destinations enforce current authorization even for old notifications. These are proposed acceptance checks derived from the constraints above.

## Questions left open for product and vendor validation

- Budget ceiling, active users versus web subscriptions, recipient-events per month, peak fan-out, and retention length.
- Whether existing transactional email stays direct Postmark, moves behind Knock, or only newly introduced email uses orchestration; which events receive which channels.
- Whether hosted inbox ownership is required or app-owned storage is acceptable under the no-self-hosted-notification-server constraint.
- A supported secure OneSignal Web SDK user/subscription binding and logout design; current documented JWT support does not meet that need.
- End-to-end Knock → OneSignal **web** delivery compatibility and web-specific payload/URL behavior, not just the documented mobile example.
- Managed event handoff/replay service and cost; vendor retries do not make the current application transaction atomic with external delivery.
- Exact plan entitlements, export/migration completeness, feed expiry controls, data-processing terms/region requirements and deletion behavior for retained backups. Public pages do not settle these contractual questions.

The next decision can compare **A for less notification infrastructure ownership** with **B for greater application control and lower transport-only fees**. Both remain conditional on production identity and durable handoff, and browser push remains best-effort. No vendor or email migration scope is selected by this research.
