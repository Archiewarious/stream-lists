import { ActionIcon, Button, ScrollArea, TextInput } from '@mantine/core';
import { IconArrowBackUp, IconSearch, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import { formatDay, groupByMonth, matchesTitle } from '@domains/lists/lib/items';
import type { ListKind } from '@domains/lists/model/useChannel';
import { HIDE_ON_HOVER, SHOW_ON_HOVER } from '@domains/lists/ui/hoverActions';
import ConfirmPopover from '@shared/ui/ConfirmPopover';
import Poster from '@shared/ui/Poster';

interface WatchedColumnProps {
  kind: ListKind;
  /** Newest first. */
  items: ItemRow[];
  onRequeue: (itemId: number) => void;
  onDelete: (itemId: number) => void;
}

const WatchedColumn = ({ kind, items, onRequeue, onDelete }: WatchedColumnProps) => {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');

  const months = groupByMonth(
    items.filter((item) => matchesTitle(item.title, query)),
    i18n.language,
  );

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
        {!items.length && <p className="px-2 py-6 text-center text-sm text-fg-3">{t('config.emptyWatched')}</p>}
        {!!items.length && !months.length && (
          <p className="px-2 py-6 text-center text-sm text-fg-3">{t('config.nothingFound')}</p>
        )}
        {months.map((month) => (
          <div key={month.key}>
            <div className="flex justify-between px-2 pt-2.5 pb-1">
              <span className="label">{month.title}</span>
              <span className="label">{month.items.length}</span>
            </div>
            {month.items.map((item) => (
              <div
                key={item.id}
                className="group flex h-11 items-center gap-2.5 rounded-xl px-2 text-[13px] font-bold hover:selected"
              >
                <span className="opacity-70">
                  <Poster path={item.poster_path} width={22} />
                </span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className={`text-xs text-fg-3 ${HIDE_ON_HOVER}`}>
                  {item.watched_at && formatDay(item.watched_at, i18n.language)}
                </span>
                <span className={`items-center gap-1 ${SHOW_ON_HOVER}`}>
                  <Button
                    variant="default"
                    size="compact-xs"
                    leftSection={<IconArrowBackUp size={13} />}
                    onClick={() => onRequeue(item.id)}
                  >
                    {t('config.requeue')}
                  </Button>
                  <ConfirmPopover
                    message={t('config.deleteItem', { title: item.title })}
                    confirmLabel={t('config.delete')}
                    onConfirm={() => onDelete(item.id)}
                  >
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('config.delete')}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </ConfirmPopover>
                </span>
              </div>
            ))}
          </div>
        ))}
      </ScrollArea>
    </section>
  );
};

export default WatchedColumn;
