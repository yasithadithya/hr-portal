'use client';

import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMarkRead, useNotifications } from '@/lib/queries/notifications';
import { cn } from '@/lib/utils';

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const list = useNotifications();
  const mark = useMarkRead();
  const unread = list.data?.unread ?? 0;
  const items = list.data?.items.slice(0, 8) ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
          data-testid="notification-bell"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              className="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
              data-testid="notification-count"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              className="text-primary text-xs font-normal hover:underline"
              onClick={() => mark.mutate('all')}
            >
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-center text-sm">
            You’re all caught up.
          </p>
        )}
        {items.map((n) => (
          <DropdownMenuItem
            key={n.id}
            className="flex flex-col items-start gap-0.5 py-2"
            data-testid="notification-item"
            onClick={() => {
              if (!n.readAt) mark.mutate(n.id);
              if (n.link) router.push(n.link);
            }}
          >
            <span className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</span>
            <span className="text-muted-foreground line-clamp-2 text-xs">{n.body}</span>
            <span className="text-muted-foreground text-[11px]">{ago(n.createdAt)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/me/notifications')}>
          Notification settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
