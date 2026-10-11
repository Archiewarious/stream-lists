import { ScrollArea } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import type { ListKind } from '@domains/lists/model/useChannel';
import { QueueList, type ItemActions } from '@domains/lists/ui/ItemLists';

interface QueueColumnProps extends ItemActions {
  kind: ListKind;
  items: ItemRow[];
  onReorder: (ids: number[]) => void;
}

const QueueColumn = ({ items, ...rest }: QueueColumnProps) => {
  const { t } = useTranslation();

  return (
    <section className="glass flex min-h-0 flex-col overflow-hidden rounded-[22px]">
      <div className="flex h-[50px] shrink-0 items-center gap-2 px-4 pt-1.5">
        <span className="label">{t('columns.queue')}</span>
        <span className="text-xs text-fg-3">{items.length}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1" px={8} pb={8}>
        <QueueList items={items} emptyText={t('config.emptyQueue')} {...rest} />
      </ScrollArea>
    </section>
  );
};

export default QueueColumn;
