import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import type { Route } from "./+types/api.purchases.$purchaseId";
import { z } from "zod";
import { db } from "~/db";
import { purchases, refunds } from "~/db/schema";
import { requireUserId } from "~/lib/access.server";

/** Exact buyer-owned status, independent of Enrollment and Notification reads. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const buyerId = await requireUserId(request);
  const parsed = z
    .object({
      purchaseId: z.coerce.number().int().positive(),
      refundRequestId: z.coerce.number().int().positive(),
    })
    .safeParse({
      purchaseId: params.purchaseId,
      refundRequestId: new URL(request.url).searchParams.get("refundRequestId"),
    });
  if (!parsed.success) throw data("Unavailable", { status: 404 });
  const purchase = db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.id, parsed.data.purchaseId),
        eq(purchases.userId, buyerId)
      )
    )
    .get();
  const refundRequest = db
    .select()
    .from(refunds)
    .where(
      and(
        eq(refunds.id, parsed.data.refundRequestId),
        eq(refunds.purchaseId, parsed.data.purchaseId)
      )
    )
    .get();
  if (!purchase || !refundRequest) throw data("Unavailable", { status: 404 });
  return { purchase, refundRequest };
}
