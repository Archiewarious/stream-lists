import type { ReactNode } from 'react';

import type { PanelItem } from '@domains/lists/lib/panelLists';

interface PanelRowProps {
  item: PanelItem;
  onOpen: (item: PanelItem) => void;
  className: string;
  children: ReactNode;
}

/** A row of the viewer panel; a button when TMDB knows the title — its card opens on click, Enter or Space. */
const PanelRow = ({ item, onOpen, className, children }: PanelRowProps) =>
  item.tmdb_id ? (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen(item);
      }}
      className={`${className} cursor-pointer`}
    >
      {children}
    </div>
  ) : (
    <div className={className}>{children}</div>
  );

export default PanelRow;
