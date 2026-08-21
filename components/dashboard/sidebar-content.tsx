'use client';

import {
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Settings,
  Shield,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/lib/auth-actions';

import { NAV_ACCOUNT, NAV_PRIMARY } from './nav-items';
import { SidebarNav, SidebarSectionTitle } from './sidebar-nav';

export function SidebarContent({
  user,
  onNavigate,
}: {
  user: { name?: string | null; email?: string | null; plan?: string | null };
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm">AI Chatbot SaaS</span>
        </Link>
      </div>

      <nav className="mt-6 flex-1 space-y-6 overflow-y-auto px-3">
        <div>
          <SidebarSectionTitle>Workspace</SidebarSectionTitle>
          <SidebarNav items={NAV_PRIMARY} onNavigate={onNavigate} />
        </div>
        <div>
          <SidebarSectionTitle>Account</SidebarSectionTitle>
          <SidebarNav items={NAV_ACCOUNT} onNavigate={onNavigate} />
        </div>
      </nav>

      <div className="border-t p-2">
        <AccountMenu user={user} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function AccountMenu({
  user,
  onNavigate,
}: {
  user: { name?: string | null; email?: string | null; plan?: string | null };
  onNavigate?: () => void;
}) {
  const displayName = user.name ?? user.email ?? 'Account';
  const email = user.email ?? '';
  const plan = (user.plan ?? 'free').toLowerCase();
  const isFree = plan === 'free';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          aria-label="Open account menu"
        >
          <Avatar name={displayName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
            {email && (
              <p className="truncate text-xs leading-tight text-muted-foreground">
                {email}
              </p>
            )}
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-70 group-hover:opacity-100" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64"
      >
        <div className="flex items-start gap-2.5 px-2 py-2.5">
          <Avatar name={displayName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
            {email && (
              <p className="truncate text-xs leading-tight text-muted-foreground">
                {email}
              </p>
            )}
            <PlanBadge plan={plan} className="mt-1.5" />
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/account/profile" onClick={onNavigate}>
            <Settings className="h-4 w-4 text-muted-foreground" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/sessions" onClick={onNavigate}>
            <Shield className="h-4 w-4 text-muted-foreground" />
            Sessions & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/usage" onClick={onNavigate}>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            {isFree ? 'Upgrade plan' : 'Usage & billing'}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 text-left"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlanBadge({ plan, className }: { plan: string; className?: string }) {
  const label = plan.toUpperCase();
  const styles: Record<string, string> = {
    free: 'bg-secondary text-secondary-foreground',
    starter: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
    pro: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[plan] ?? styles.free} ${className ?? ''}`}
    >
      {label}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
      {initials || '?'}
    </span>
  );
}
