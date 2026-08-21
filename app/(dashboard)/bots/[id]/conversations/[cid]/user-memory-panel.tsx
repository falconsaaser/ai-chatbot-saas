'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Read-only user memory panel with per-row delete (privacy / GDPR).
 * Renders whatever observations the server passes in — no client fetching.
 * Delete goes through the /api/bots/[id]/end-users/... route and a router
 * refresh so the SSR page re-renders with the new set.
 */
export function UserMemoryPanel({
  botId,
  endUserRefId,
  endUserProfile,
  observations,
}: {
  botId: string;
  endUserRefId: string | null;
  endUserProfile: {
    name: string | null;
    email: string | null;
    phone: string | null;
    tags: string[];
  } | null;
  observations: Array<{ id: string; content: string; createdAt: Date }>;
}) {
  if (!endUserRefId) {
    // Anonymous session (e.g. widget visitor with no cookie yet). No memory
    // record to render.
    return null;
  }

  const hasProfile =
    endUserProfile &&
    (endUserProfile.name ||
      endUserProfile.email ||
      endUserProfile.phone ||
      endUserProfile.tags.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">User memory</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {hasProfile && (
          <div className="space-y-1.5 border-b border-border pb-3">
            {endUserProfile!.name && (
              <ProfileLine label="Name" value={endUserProfile!.name} />
            )}
            {endUserProfile!.email && (
              <ProfileLine label="Email" value={endUserProfile!.email} />
            )}
            {endUserProfile!.phone && (
              <ProfileLine label="Phone" value={endUserProfile!.phone} />
            )}
            {endUserProfile!.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {endUserProfile!.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {observations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No cross-session memory for this visitor yet. Facts extracted from
            future conversations will appear here and will be pulled into the
            system prompt when this visitor returns.
          </p>
        ) : (
          <ul className="space-y-2">
            {observations.map((o) => (
              <ObservationRow
                key={o.id}
                botId={botId}
                endUserRefId={endUserRefId}
                observation={o}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function ObservationRow({
  botId,
  endUserRefId,
  observation,
}: {
  botId: string;
  endUserRefId: string;
  observation: { id: string; content: string; createdAt: Date };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleted, setDeleted] = useState(false);

  if (deleted) return null;

  const onDelete = () => {
    startTransition(async () => {
      const res = await fetch(
        `/api/bots/${botId}/end-users/${endUserRefId}/observations/${observation.id}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        setDeleted(true);
        router.refresh();
      }
    });
  };

  return (
    <li className="group flex items-start justify-between gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">{observation.content}</p>
        <p className="text-[11px] text-muted-foreground">
          {observation.createdAt.toLocaleDateString()}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 opacity-0 transition group-hover:opacity-100"
        onClick={onDelete}
        disabled={pending}
        aria-label="Delete observation"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
