import { sql } from "drizzle-orm";
import { notifications, UserRole, TeamMemberRole } from "~/db/schema";

// Persistent access only: country/PPP restrictions belong to the recipient's
// request and must never erase history merely because someone travels.
const discussionAccess = sql`exists (
  select 1 from comments q
  join lessons l on l.id = q.lesson_id
  join modules m on m.id = l.module_id
  join courses c on c.id = m.course_id
  join users u on u.id = ${notifications.recipientId}
  where q.id = ${notifications.questionId}
    and l.id = ${notifications.lessonId} and q.parent_id is null
    and (u.role = ${UserRole.Admin} or c.instructor_id = u.id or exists (
      select 1 from enrollments e where e.user_id = u.id and e.course_id = c.id
    ))
    and ((${notifications.kind} = 'question_created' and q.deleted_at is null)
      or (${notifications.kind} = 'reply_created' and exists (
        select 1 from comments r where r.id = ${notifications.replyId}
          and r.parent_id = q.id and r.lesson_id = l.id and r.deleted_at is null
      )))
)`;

export const persistentNotificationAccess = sql`(
  (${notifications.kind} in ('question_created', 'reply_created') and ${discussionAccess})
  or (${notifications.kind} in ('refund_requested', 'refund_approved', 'refund_declined') and exists (
    select 1 from refunds r join purchases p on p.id = r.purchase_id
    join users u on u.id = ${notifications.recipientId}
    where r.id = ${notifications.refundRequestId} and p.id = ${notifications.purchaseId}
      and ((${notifications.kind} = 'refund_requested' and u.role = ${UserRole.Admin})
        or (${notifications.kind} in ('refund_approved', 'refund_declined') and p.user_id = u.id))
  ))
  or (${notifications.kind} = 'seat_claimed' and exists (
    select 1 from coupons s join team_members tm on tm.team_id = s.team_id
    where s.id = ${notifications.seatId} and s.team_id = ${notifications.teamId}
      and s.redeemed_at is not null and tm.user_id = ${notifications.recipientId}
      and tm.role = ${TeamMemberRole.Admin}
  ))
)`;
