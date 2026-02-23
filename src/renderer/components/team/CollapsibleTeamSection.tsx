import { useState } from 'react';

import { Badge } from '@renderer/components/ui/badge';
import { ChevronRight } from 'lucide-react';

interface CollapsibleTeamSectionProps {
  title: string;
  badge?: string | number;
  /** Secondary badge (e.g. unread count). Shown next to main badge when defined. */
  secondaryBadge?: number;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export const CollapsibleTeamSection = ({
  title,
  badge,
  secondaryBadge,
  defaultOpen = true,
  forceOpen,
  action,
  children,
}: CollapsibleTeamSectionProps): React.JSX.Element => {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen ? true : open;

  return (
    <section className="border-b border-[var(--color-border)] py-3 last:border-b-0">
      <div className="flex items-center">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((prev) => !prev)}
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
          />
          <span className="text-sm font-medium text-[var(--color-text)]">{title}</span>
          {badge != null && (
            <Badge
              variant="secondary"
              className="px-1.5 py-0.5 text-[10px] font-normal leading-none"
            >
              {badge}
            </Badge>
          )}
          {secondaryBadge != null && secondaryBadge >= 0 && (
            <Badge
              variant="secondary"
              className={
                secondaryBadge > 0
                  ? 'bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-normal leading-none text-blue-400'
                  : 'px-1.5 py-0.5 text-[10px] font-normal leading-none text-[var(--color-text-muted)]'
              }
              title={secondaryBadge > 0 ? `${secondaryBadge} unread` : undefined}
            >
              {secondaryBadge}
            </Badge>
          )}
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {isOpen && <div className="mt-2">{children}</div>}
    </section>
  );
};
