import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { bots, endUsers, observations } from '@/db/schema';
import { requireAuth } from '@/lib/server/require-auth';

export const runtime = 'nodejs';

/**
 * Delete one observation. Ownership check is bot → user; the endUser and
 * observation both belong to the bot so ownership is transitive.
 */
export async function DELETE(
  _req: Request,
  {
    params,
  }: { params: Promise<{ id: string; endUserRefId: string; obsId: string }> },
) {
  const user = await requireAuth();
  const { id: botId, endUserRefId, obsId } = await params;

  const bot = await db.query.bots.findFirst({
    where: and(eq(bots.id, botId), eq(bots.userId, user.id)),
  });
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const endUser = await db.query.endUsers.findFirst({
    where: and(eq(endUsers.id, endUserRefId), eq(endUsers.botId, botId)),
  });
  if (!endUser) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const result = await db
    .delete(observations)
    .where(
      and(
        eq(observations.id, obsId),
        eq(observations.endUserRefId, endUserRefId),
      ),
    )
    .returning({ id: observations.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: result[0].id });
}
