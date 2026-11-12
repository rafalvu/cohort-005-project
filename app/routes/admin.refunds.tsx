import { useState } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { requireAdmin } from "~/lib/access.server";
import { listRefundRequests, resolveRefund } from "~/lib/refunds.server";
import { RefundStatus } from "~/db/schema";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import { Button } from "~/components/ui/button";

const decisionSchema = z.object({
  refundId: z.coerce.number().int().positive(),
  decision: z.enum(["approve", "decline"]),
});

export function meta() {
  return [{ title: "Refund requests — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return { requests: await listRefundRequests(request) };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const parsed = parseFormData(await request.formData(), decisionSchema);
  if (!parsed.success)
    return data(
      { error: "Choose a valid refund request and decision." },
      { status: 400 }
    );
  try {
    await resolveRefund(request, parsed.data.refundId, parsed.data.decision);
    return { error: null };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "init" in error &&
      "data" in error &&
      typeof error.init === "object" &&
      error.init !== null &&
      "status" in error.init &&
      typeof error.init.status === "number"
    ) {
      return data({ error: String(error.data) }, { status: error.init.status });
    }
    throw error;
  }
}

type RefundRequest = Awaited<ReturnType<typeof listRefundRequests>>[number];

function date(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function RequestRow({ refund }: { refund: RefundRequest }) {
  const fetcher = useFetcher<typeof action>();
  const [confirmApproval, setConfirmApproval] = useState(false);
  const busy = fetcher.state !== "idle";
  const pending = refund.status === RefundStatus.Requested;
  return (
    <article
      className="border-b border-border py-6 last:border-0"
      aria-labelledby={`refund-${refund.id}`}
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          <h3 id={`refund-${refund.id}`} className="text-lg font-semibold">
            <Link
              to={`/courses/${refund.courseSlug}`}
              className="hover:underline"
            >
              {refund.courseTitle}
            </Link>
          </h3>
          <p className="mt-1 break-words text-sm">
            {refund.learnerName}{" "}
            <span className="text-muted-foreground">
              · {refund.learnerEmail}
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Purchased {date(refund.purchasedAt)} · Requested{" "}
            {date(refund.requestedAt)}
          </p>
          <p className="mt-4 max-w-prose whitespace-pre-wrap break-words text-sm">
            {refund.reason}
          </p>
          {refund.progress && (
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm tabular-nums">
              <div>
                <dt className="text-muted-foreground">
                  Current lesson completion
                </dt>
                <dd className="mt-1 font-medium">
                  {refund.progress.completedLessons} /{" "}
                  {refund.progress.totalLessons} lessons (
                  {refund.progress.percentage}%)
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Recorded video progress
                </dt>
                <dd className="mt-1 font-medium">
                  {Math.floor(refund.progress.videoSeconds / 60)} min{" "}
                  {Math.floor(refund.progress.videoSeconds % 60)} sec
                </dd>
              </div>
            </dl>
          )}
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums">
            {formatPrice(refund.amountApproved ?? refund.amountPaid)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending
              ? "Full amount paid"
              : refund.status === RefundStatus.Approved
                ? "Approved amount · payment not processed"
                : "Declined · no refund approved"}
          </p>
          {pending ? (
            <fetcher.Form method="post" className="mt-4 space-y-3">
              <input type="hidden" name="refundId" value={refund.id} />
              {confirmApproval ? (
                <>
                  <p className="text-sm">
                    Approval removes course access and archives progress. Buying
                    again starts from zero.
                  </p>
                  <Button
                    name="decision"
                    value="approve"
                    type="submit"
                    disabled={busy}
                    className="w-full"
                  >
                    {busy ? "Saving…" : "Confirm approval"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmApproval(false)}
                    className="w-full"
                  >
                    Back
                  </Button>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmApproval(true)}
                  >
                    Approve
                  </Button>
                  <Button
                    type="submit"
                    name="decision"
                    value="decline"
                    variant="outline"
                    disabled={busy}
                  >
                    {busy ? "Saving…" : "Decline"}
                  </Button>
                </div>
              )}
              {fetcher.data?.error && (
                <p role="alert" className="text-sm text-destructive">
                  {fetcher.data.error}
                </p>
              )}
            </fetcher.Form>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {refund.status === RefundStatus.Approved
                ? "Approved"
                : "Declined"}{" "}
              by {refund.resolvedByName ?? "an admin"}
              {refund.resolvedAt ? ` on ${date(refund.resolvedAt)}` : ""}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const pending = loaderData.requests.filter(
    (refund) => refund.status === RefundStatus.Requested
  );
  const resolved = loaderData.requests
    .filter((refund) => refund.status !== RefundStatus.Requested)
    .reverse();
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <h1 className="text-3xl font-bold">Refund requests</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Review individual purchases and decide each request. Approval ends
        course access and archives progress. It does not transfer money.
      </p>
      <section className="mt-8" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="text-xl font-semibold">
          Pending review ({pending.length})
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Oldest requests first. Progress is current; video progress adds the
          furthest playback position in each lesson, not time spent watching.
        </p>
        {pending.length ? (
          pending.map((refund) => (
            <RequestRow key={refund.id} refund={refund} />
          ))
        ) : (
          <p className="py-8 text-muted-foreground">
            No pending individual refund requests.
          </p>
        )}
      </section>
      <section className="mt-10" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-xl font-semibold">
          Decision history ({resolved.length})
        </h2>
        {resolved.length ? (
          resolved.map((refund) => (
            <RequestRow key={refund.id} refund={refund} />
          ))
        ) : (
          <p className="py-6 text-muted-foreground">
            Decisions will appear here after review.
          </p>
        )}
      </section>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <h1 className="text-2xl font-bold">Unable to open refund requests</h1>
      <p className="mt-3">
        {isRouteErrorResponse(error) && typeof error.data === "string"
          ? error.data
          : "Please try again."}
      </p>
      <Link to="/login" className="mt-4 inline-block underline">
        Sign in
      </Link>
    </div>
  );
}
