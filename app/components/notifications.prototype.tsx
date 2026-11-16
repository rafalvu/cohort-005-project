// THROWAWAY: three Notifications layouts on /courses?variant=A|B|C.
// Existing shell/tokens and host loader are preserved. All notification data is synthetic and memory-only.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Menu,
  MessageSquare,
  Receipt,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { Sidebar } from "./sidebar";
import { Button } from "./ui/button";
import { UserRole } from "~/db/schema";
import "./notifications.prototype.css";

type Update = {
  id: number;
  kind: "question" | "reply" | "request" | "decision" | "seat";
  title: string;
  context: string;
  detail: string;
  time: string;
  unread: boolean;
  status: string;
  destination: string;
};
const initial: Update[] = [
  {
    id: 1,
    kind: "question",
    title: "Maya Chen asked a question",
    context: "TypeScript Foundations · Narrowing",
    detail:
      "How should I narrow a union when two members share the same property, but only one permits an optional callback with a generic return type?",
    time: "4 min ago",
    unread: true,
    status: "Awaiting staff reply",
    destination: "/courses/typescript-foundations/lessons/12#question-81",
  },
  {
    id: 2,
    kind: "request",
    title: "Jonah Reed requested a refund",
    context: "Practical React · Individual Purchase",
    detail:
      "I bought this course twice using two accounts. Could you review this Purchase?",
    time: "18 min ago",
    unread: true,
    status: "Open Refund Request",
    destination: "/admin/refunds?request=42",
  },
  {
    id: 3,
    kind: "reply",
    title: "Priya Shah replied to your question",
    context: "Advanced TypeScript · Conditional types",
    detail:
      "Try moving the condition into the generic constraint. That preserves the relationship between the input and the return type.",
    time: "42 min ago",
    unread: true,
    status: "Peer reply · awaiting staff reply",
    destination: "/courses/advanced-typescript/lessons/26#question-95",
  },
  {
    id: 4,
    kind: "seat",
    title: "Alex Morgan claimed a Seat",
    context: "Northstar Studio · TypeScript Foundations",
    detail:
      "Alex claimed a Seat on the Northstar Studio Team Licence. 8 of 12 Seats are now claimed.",
    time: "1 hour ago",
    unread: true,
    status: "8 of 12 Seats claimed",
    destination: "/team?team=7&purchase=31",
  },
  {
    id: 5,
    kind: "decision",
    title: "Your Refund Request was approved",
    context: "Design Systems in React · Your Purchase",
    detail:
      "Your Refund Request has been approved. Approval does not confirm that money has been returned. Your course Enrollment has ended.",
    time: "Yesterday",
    unread: false,
    status: "Approved Refund Request",
    destination: "/settings?purchase=18&request=38",
  },
  {
    id: 6,
    kind: "request",
    title: "Sam Rivera requested a refund",
    context: "CSS for Product Teams · Individual Purchase",
    detail:
      "This request was already declined by another Platform Admin. The decision cannot be made again.",
    time: "Yesterday",
    unread: true,
    status: "Declined by Morgan Lee",
    destination: "/admin/refunds?request=39",
  },
  {
    id: 7,
    kind: "question",
    title: "Elena García asked a question",
    context:
      "Building Accessible Interfaces for International Teams · Managing focus across nested navigation and asynchronous updates",
    detail:
      "When a background update removes the item that currently has keyboard focus, where should focus move without disrupting someone who is still reading the surrounding context?",
    time: "2 days ago",
    unread: false,
    status: "Awaiting staff reply",
    destination: "/courses/accessible-interfaces/lessons/44#question-120",
  },
];
const variants = ["A", "B", "C"];
const names = ["Full page", "Side drawer", "List + detail"];
const events = [
  "New questions",
  "Replies",
  "New Refund Requests",
  "Refund decisions",
  "Seat claims",
];
function EventIcon({ kind }: { kind: Update["kind"] }) {
  const Icon =
    kind === "seat"
      ? Users
      : kind === "request" || kind === "decision"
        ? Receipt
        : MessageSquare;
  return <Icon size={18} aria-hidden="true" />;
}

export function NotificationsPrototype({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const variant = variants.includes(params.get("variant") || "")
    ? params.get("variant")!
    : "A";
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<Update | null>(null);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("list");
  const [scene, setScene] = useState("populated");
  const [mobileNav, setMobileNav] = useState(false);
  const [permission, setPermission] = useState("not-asked");
  const [prompt, setPrompt] = useState(false);
  const [master, setMaster] = useState(false);
  const [prefs, setPrefs] = useState([true, true, true, false, false]);
  const [source, setSource] = useState("Notifications");
  const [landing, setLanding] = useState("authorized");
  const [signedIn, setSignedIn] = useState(true);
  const [notice, setNotice] = useState("");
  const [lab, setLab] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const notificationTrigger = useRef<HTMLButtonElement>(null);
  const unread = items.filter((n) => n.unread).length;
  const visible = items.filter((n) => filter !== "unread" || n.unread);
  function changeVariant(offset: number) {
    setParams(
      (p) => {
        p.set(
          "variant",
          variants[(variants.indexOf(variant) + offset + 3) % 3]
        );
        return p;
      },
      { replace: true }
    );
    setOpen(true);
    setView("list");
    setSelected(null);
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true],[role=slider]"
        )
      )
        return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        changeVariant(e.key === "ArrowRight" ? 1 : -1);
      }
      if (e.key === "Escape") {
        setMobileNav(false);
        setOpen(false);
        notificationTrigger.current?.focus();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (selected || view === "preferences") heading.current?.focus();
  }, [selected, view]);
  function mark(id?: number) {
    setItems((list) =>
      list.map((n) =>
        id === undefined || n.id === id ? { ...n, unread: false } : n
      )
    );
    setNotice(
      id === undefined
        ? "Existing Notifications marked as read. Underlying work is unchanged."
        : "Marked as read. Underlying work is unchanged."
    );
  }
  function showList() {
    setOpen(true);
    setSelected(null);
    setView("list");
    setMobileNav(false);
  }
  function visit(n: Update, from = "Notifications") {
    setSelected(n);
    setSource(from);
    setView("detail");
    setOpen(true);
    if (from === "Notifications") mark(n.id);
  }
  function simulate(value: string) {
    setScene(value);
    setSelected(null);
    setView("list");
    setOpen(true);
    if (value === "empty") setItems([]);
    else if (value === "all-read")
      setItems(initial.map((n) => ({ ...n, unread: false })));
    else setItems(initial.map((n) => ({ ...n })));
    setNotice("");
  }
  function reset() {
    simulate("populated");
    setPermission("not-asked");
    setMaster(false);
    setPrefs([true, true, true, false, false]);
    setPrompt(false);
    setLanding("authorized");
    setSignedIn(true);
    setFilter("all");
  }
  function external(from: string) {
    setSource(from);
    setView("external");
    setOpen(true);
    setSelected(null);
  }
  function removeAccess() {
    const id = selected?.id ?? 1;
    setItems((list) => list.filter((n) => n.id !== id));
    setLanding("unavailable");
    setNotice(
      "The inaccessible Notification was removed, including from the unread count."
    );
    if (!selected)
      visit(items.find((n) => n.id === id) ?? initial[0], "Old push link");
  }
  const detail = selected ? (
    <section className="np-detail" aria-label="Linked item">
      <Button variant="ghost" onClick={showList}>
        <ArrowLeft />
        Back to Notifications
      </Button>
      {landing === "unavailable" ? (
        <div className="np-empty">
          <h2 ref={heading} tabIndex={-1}>
            This content is unavailable
          </h2>
          <p>It may no longer be available to your account.</p>
        </div>
      ) : !signedIn ? (
        <div className="np-empty">
          <h2 ref={heading} tabIndex={-1}>
            Sign in to continue
          </h2>
          <p>We’ll return you to the linked item after sign-in.</p>
          <Button onClick={() => setSignedIn(true)}>
            Continue as demo user
          </Button>
        </div>
      ) : (
        <>
          <p className="np-muted np-context">{selected.context}</p>
          <h2 ref={heading} tabIndex={-1}>
            {selected.kind === "question" || selected.kind === "reply"
              ? "Question thread"
              : selected.kind === "seat"
                ? "Northstar Studio’s Seats"
                : "Refund Request"}
          </h2>
          <span className="np-status">
            {items.find((n) => n.id === selected.id)?.status ?? selected.status}
          </span>
          <h3>{selected.title}</h3>
          <p className="np-copy">{selected.detail}</p>
          {selected.kind === "question" || selected.kind === "reply" ? (
            <div className="np-note">
              Replying as the owning Instructor or a Platform Admin handles this
              question. Reading it does not.
            </div>
          ) : null}
          {selected.id === 2 &&
          items.find((n) => n.id === 2)?.status === "Open Refund Request" ? (
            <Button
              onClick={() => {
                setItems((list) =>
                  list.map((n) =>
                    n.id === 2 ? { ...n, status: "Approved by Morgan Lee" } : n
                  )
                );
                setNotice(
                  "Another Admin approved the request. Your read state did not change."
                );
              }}
            >
              Simulate another Admin’s approval
            </Button>
          ) : null}
          {selected.kind === "request" &&
          (items.find((n) => n.id === selected.id)?.status ??
            selected.status) !== "Open Refund Request" ? (
            <p>
              This request has already been decided. No further decision is
              available.
            </p>
          ) : null}
          <div className="np-note">
            Opened from {source}.{" "}
            {source === "Notifications"
              ? "This Notification is now read."
              : "Saved Notification read state is unchanged."}
          </div>
          <details className="np-route">
            <summary>Prototype destination</summary>
            <code>{selected.destination}</code>
            <p>
              Illustrated landing with synthetic data; this is not a production
              deep link.
            </p>
          </details>
        </>
      )}
    </section>
  ) : null;
  const list = (
    <section className="np-list" aria-label="Notifications list">
      <div className="np-list-tools">
        <div className="np-tabs" aria-label="Filter Notifications">
          <button
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            aria-pressed={filter === "unread"}
            onClick={() => setFilter("unread")}
          >
            Unread <span>{unread}</span>
          </button>
        </div>
        <Button
          variant="ghost"
          disabled={!unread || scene === "loading" || scene === "error"}
          onClick={() => mark()}
        >
          Mark all as read
        </Button>
      </div>
      {scene === "loading" ? (
        <div className="np-empty" role="status">
          <h3>Loading Notifications…</h3>
          <p>Checking for your latest updates.</p>
          <Button variant="outline" onClick={() => setScene("populated")}>
            Finish loading (demo)
          </Button>
        </div>
      ) : scene === "error" ? (
        <div className="np-empty" role="alert">
          <h3>Notifications couldn’t load</h3>
          <p>Please try again. Your updates haven’t been changed.</p>
          <Button onClick={() => setScene("populated")}>Try again</Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="np-empty">
          <Bell size={26} />
          <h3>
            {filter === "unread" && items.length
              ? "You’re all caught up"
              : "No Notifications yet"}
          </h3>
          <p>
            {filter === "unread" && items.length
              ? "Your read Notifications are still in All."
              : "Updates about questions, Refund Requests and your team’s Seats will appear here."}
          </p>
          {filter === "unread" && items.length > 0 ? (
            <Button variant="outline" onClick={() => setFilter("all")}>
              View all Notifications
            </Button>
          ) : null}
        </div>
      ) : (
        <ul>
          {visible.map((n) => (
            <li
              key={n.id}
              className={`${n.unread ? "np-unread" : ""} ${selected?.id === n.id ? "np-selected" : ""}`}
            >
              <button
                className="np-item"
                onClick={() => visit(n)}
                aria-label={`${n.unread ? "Unread: " : "Read: "}${n.title}. ${n.context}. ${n.status}`}
              >
                <span className="np-event-icon">
                  <EventIcon kind={n.kind} />
                </span>
                <span className="np-item-content">
                  <span className="np-item-title">{n.title}</span>
                  <span className="np-muted">{n.context}</span>
                  <span className="np-status">{n.status}</span>
                  <span className="np-time">{n.time}</span>
                </span>
                <span className="np-read-indicator" aria-hidden="true">
                  {n.unread ? <span className="np-dot" /> : <Check size={14} />}
                </span>
              </button>
              {n.unread ? (
                <button
                  className="np-mark"
                  aria-label={`Mark as read: ${n.title}`}
                  onClick={() => mark(n.id)}
                >
                  <Check size={16} />
                  <span>Mark as read</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="np-retention">
        Notifications show the last 90 days. Reading an update doesn’t handle
        the underlying work.
      </p>
    </section>
  );
  const preferences = (
    <section className="np-preferences">
      <Button variant="ghost" onClick={showList}>
        <ArrowLeft />
        Back to Notifications
      </Button>
      <h2 ref={heading} tabIndex={-1}>
        Notification preferences
      </h2>
      <p className="np-muted">
        Saved Notifications are always on. Choose whether you also want browser
        alerts.
      </p>
      <div className="np-setting">
        <div>
          <h3>Push notifications</h3>
          <p>Account-wide. Applies to every device you’ve enabled.</p>
        </div>
        <input
          aria-label="Account-wide push notifications"
          type="checkbox"
          checked={master}
          onChange={(e) => setMaster(e.target.checked)}
        />
      </div>
      <h3>This browser</h3>
      <p>
        {
          (
            {
              "not-asked":
                "Not enabled. Choose Enable push notifications to ask this browser for permission.",
              granted:
                "Permission granted on this browser. Alerts also depend on your account preferences.",
              denied:
                "Permission is blocked. Change this site’s notification permission in your browser settings, then return here.",
              revoked:
                "Permission was removed. This browser will no longer receive push notifications.",
              unsupported:
                "Push is unavailable in this browser. Your saved Notifications still work.",
              ios: "On a compatible iPhone or iPad, add Cadence to your Home Screen, open it there, then enable push notifications.",
              disconnected:
                "This browser was disconnected on logout. Sign in and explicitly enable it again.",
            } as Record<string, string>
          )[permission]
        }
      </p>
      {!master && (
        <p className="np-note">
          Push is off for your account. Granting permission alone won’t turn
          account-wide delivery on.
        </p>
      )}
      {(permission === "not-asked" || permission === "disconnected") && (
        <Button onClick={() => setPrompt(true)}>
          Enable push notifications
        </Button>
      )}
      {(permission === "denied" || permission === "revoked") && (
        <Button
          variant="outline"
          onClick={() =>
            setNotice(
              "Open your browser’s site settings and allow Notifications. The prototype does not change browser permissions."
            )
          }
        >
          How to change permission
        </Button>
      )}
      {prompt && (
        <div className="np-prompt">
          <strong>Prototype: browser permission handoff</strong>
          <p>
            The browser owns the next prompt. No real permission is requested
            here. Choose an outcome to explore the flow.
          </p>
          <div className="np-actions">
            <Button
              onClick={() => {
                setPermission("granted");
                setPrompt(false);
              }}
            >
              Simulate granted
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPermission("denied");
                setPrompt(false);
              }}
            >
              Simulate denied
            </Button>
            <Button variant="ghost" onClick={() => setPrompt(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <fieldset>
        <legend>Push by event</legend>
        {events.map((event, i) => (
          <label className="np-event-setting" key={event}>
            <span>
              {event}
              <small>
                {i < 2
                  ? "Grouped by question thread over five minutes"
                  : i === 2
                    ? "Attempted without deliberate delay"
                    : "Optional · off by default"}
              </small>
            </span>
            <input
              type="checkbox"
              checked={prefs[i]}
              onChange={(e) =>
                setPrefs((p) =>
                  p.map((v, j) => (i === j ? e.target.checked : v))
                )
              }
            />
          </label>
        ))}
      </fieldset>
      <p className="np-muted">
        Delivery isn’t guaranteed. Push previews omit conversation text, refund
        reasons, amounts and email addresses.
      </p>
      <h3>Email</h3>
      <p>
        Refund Request acknowledgements and decisions use the existing email
        workflow. No other email notifications or replacement emails for missed
        push are included.
      </p>
      <Button
        variant="outline"
        onClick={() => external("Refund decision email")}
      >
        Preview refund email and link
      </Button>
    </section>
  );
  const externalView = (
    <section className="np-external">
      <Button variant="ghost" onClick={showList}>
        <ArrowLeft />
        Back to Notifications
      </Button>
      <h2>External preview</h2>
      <p className="np-muted">
        Synthetic {source.toLowerCase()}. Private details appear only after
        sign-in and an access check.
      </p>
      <div className="np-preview">
        <strong>Cadence</strong>
        <h3>
          {source === "Grouped push"
            ? "New activity in a question thread"
            : source === "Refund acknowledgement email"
              ? "We received your Refund Request"
              : "Your Refund Request was approved"}
        </h3>
        <p>
          {source === "Grouped push"
            ? "Open Cadence to view the updates."
            : source === "Refund acknowledgement email"
              ? "Sign in to view the status of your request."
              : "Approval does not confirm that money has been returned. Sign in to view your request."}
        </p>
        <Button
          onClick={() =>
            visit(
              source === "Grouped push"
                ? (items.find((n) => n.id === 3) ?? initial[2])
                : initial[4],
              source
            )
          }
        >
          View{" "}
          {source === "Grouped push" ? "question thread" : "Refund Request"}
          <ChevronRight />
        </Button>
      </div>
      <p>Opening this link leaves saved Notifications unread.</p>
    </section>
  );
  const content =
    view === "preferences" ? (
      preferences
    ) : view === "external" ? (
      externalView
    ) : variant === "C" ? (
      <div className={`np-split ${selected ? "np-has-selection" : ""}`}>
        {list}
        {detail ?? (
          <div className="np-detail np-empty">
            <MessageSquare size={28} />
            <h2>Select an update</h2>
            <p>Read the linked item here while keeping the list in view.</p>
          </div>
        )}
      </div>
    ) : (
      (detail ?? list)
    );
  return (
    <div className="np-root">
      <div className="np-mobile-header">
        <Button
          variant="ghost"
          aria-label="Toggle navigation"
          onClick={() => setMobileNav(!mobileNav)}
        >
          <Menu />
        </Button>
        <strong>Cadence</strong>
        <Button
          ref={notificationTrigger}
          variant="ghost"
          onClick={showList}
          aria-label={`Notifications, ${unread} unread`}
        >
          <Bell />
          {unread}
        </Button>
      </div>
      <div className={`np-sidebar ${mobileNav ? "np-nav-open" : ""}`}>
        <Sidebar
          currentUser={{
            id: -1,
            name: "Taylor Brooks",
            role: UserRole.Admin,
            avatarUrl: null,
          }}
          isTeamAdmin
          prototypeNotifications={{ unread, active: open, open: showList }}
        />
      </div>
      <main className={`np-main np-variant-${variant}`}>
        <div className="np-review-banner">
          <span>Disposable prototype · Synthetic mixed-role account</span>
          <Button
            variant="ghost"
            onClick={() => setLab(!lab)}
            aria-expanded={lab}
          >
            {lab ? "Hide" : "Show"} scenarios
          </Button>
        </div>
        {lab && (
          <section className="np-lab" aria-label="Prototype scenarios">
            <h2>Try a scenario</h2>
            <div className="np-lab-grid">
              <label>
                List state
                <select
                  value={scene}
                  onChange={(e) => simulate(e.target.value)}
                >
                  {["populated", "all-read", "empty", "loading", "error"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    )
                  )}
                </select>
              </label>
              <label>
                Browser support / permission
                <select
                  value={permission}
                  onChange={(e) => {
                    setPermission(e.target.value);
                    setPrompt(false);
                    setOpen(true);
                    setView("preferences");
                  }}
                >
                  {[
                    "not-asked",
                    "granted",
                    "denied",
                    "revoked",
                    "unsupported",
                    "ios",
                    "disconnected",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Link access
                <select
                  value={landing}
                  onChange={(e) => setLanding(e.target.value)}
                >
                  <option value="authorized">Authorized</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label>
                Session
                <select
                  value={signedIn ? "signed-in" : "signed-out"}
                  onChange={(e) => setSignedIn(e.target.value === "signed-in")}
                >
                  <option value="signed-in">Signed in</option>
                  <option value="signed-out">Signed out</option>
                </select>
              </label>
            </div>
            <div className="np-actions">
              <Button
                variant="outline"
                onClick={() => external("Grouped push")}
              >
                Open push preview
              </Button>
              <Button
                variant="outline"
                onClick={() => external("Refund acknowledgement email")}
              >
                Open acknowledgement email
              </Button>
              <Button
                variant="outline"
                onClick={() => external("Refund decision email")}
              >
                Open decision email
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setItems((list) => [
                    {
                      ...initial[0],
                      id: Math.max(0, ...list.map((n) => n.id)) + 1,
                      time: "Just now",
                      unread: true,
                    },
                    ...list,
                  ]);
                  setScene("populated");
                  setNotice("New Notification arrived unread.");
                }}
              >
                New update arrives
              </Button>
              <Button variant="outline" onClick={removeAccess}>
                Remove access to selected / first item
              </Button>
              <Button variant="ghost" onClick={reset}>
                Reset demo
              </Button>
            </div>
            <details>
              <summary>Live prototype state</summary>
              <pre>
                {JSON.stringify(
                  {
                    variant,
                    unread,
                    view,
                    source,
                    landing,
                    signedIn,
                    permission,
                    accountPush: master,
                    events: prefs,
                    notifications: items.map(({ id, unread, status }) => ({
                      id,
                      unread,
                      status,
                    })),
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          </section>
        )}
        {notice && (
          <div role="status" className="np-feedback">
            {notice}
            <button
              aria-label="Close status message"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className={`np-workspace ${open ? "np-is-open" : ""}`}>
          {(!open || variant === "B") && (
            <div className="np-host">
              {children}
              {!open && (
                <Button onClick={showList}>
                  <Bell />
                  Open Notifications
                </Button>
              )}
            </div>
          )}
          {open && (
            <section
              className={`np-surface ${variant === "B" ? "np-drawer" : ""}`}
              aria-label="Notifications"
            >
              <header className="np-heading">
                <div>
                  <h1>Notifications</h1>
                  <p>
                    {unread} unread <span aria-hidden="true">·</span> Updates
                    across your courses and team
                  </p>
                </div>
                <div className="np-actions">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setView("preferences");
                      setSelected(null);
                    }}
                    aria-label="Notification preferences"
                  >
                    <Settings2 />
                    <span className="np-preferences-label">Preferences</span>
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Close Notifications"
                    onClick={() => {
                      setOpen(false);
                      notificationTrigger.current?.focus();
                    }}
                  >
                    <X />
                  </Button>
                </div>
              </header>
              {view === "list" && !selected && permission === "not-asked" && (
                <div className="np-discovery">
                  <Bell size={18} />
                  <p>Want updates when you’re away?</p>
                  <button onClick={() => setView("preferences")}>
                    Set up push notifications
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
              {content}
            </section>
          )}
        </div>
      </main>
      {import.meta.env.DEV && (
        <div className="np-switcher" aria-label="Prototype layout switcher">
          <button
            aria-label="Previous layout"
            onClick={() => changeVariant(-1)}
          >
            <ArrowLeft size={18} />
          </button>
          <span>
            <strong>
              {variant} · {names[variants.indexOf(variant)]}
            </strong>
            <small>
              Prototype · {unread} unread · {view}
            </small>
          </span>
          <button aria-label="Next layout" onClick={() => changeVariant(1)}>
            <ArrowRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
