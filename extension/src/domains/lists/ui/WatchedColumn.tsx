import { ScrollArea, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import { matchesTitle } from '@domains/lists/lib/items';
import type { ListKind } from '@domains/lists/model/useChannel';
import { WatchedList, type ItemActions } from '@domains/lists/ui/ItemLists';

interface WatchedColumnProps extends ItemActions {
  kind: ListKind;
  /** Newest first. */
  items: ItemRow[];
}

const WatchedColumn = ({ kind, items, ...actions }: WatchedColumnProps) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const found = items.filter((item) => matchesTitle(item.title, query));

  return (
    <section className="glass flex min-h-0 flex-col overflow-hidden rounded-[22px]">
      <div className="flex h-[50px] shrink-0 items-center gap-2 px-4 pt-1.5">
        <span className="label">{t(`columns.${kind}.watched`)}</span>
        <span className="text-xs text-fg-3">{items.length}</span>
        <TextInput
          className="ml-auto w-36"
          size="xs"
          leftSection={<IconSearch size={14} />}
          placeholder={t('config.search')}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" px={8} pb={8}>
        <WatchedList
          items={found}
          emptyText={t(items.length ? 'config.nothingFound' : 'config.emptyWatched')}
          {...actions}
        />
      </ScrollArea>
    </section>
  );
};

export default WatchedColumn;
