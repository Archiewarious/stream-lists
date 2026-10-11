import { useTranslation } from 'react-i18next';

import { normalizeTitle } from '@worker/pointauc';
import type { ChannelList, ItemRow } from '@worker/snapshot';
import { formatDay } from '@domains/lists/lib/items';
import type { Channel, ItemStatus, MovieFields } from '@domains/lists/model/useChannel';

/**
 * Adds a title (to the queue or straight to "watched") unless the list already has it. Returns a message about
 * where it is when it was not added, null when it was. `onAddedWatched` gets the new watched item (to ask for a rating).
 */
export const useAddItem = (
  channel: Channel,
  list: ChannelList | undefined,
  status: ItemStatus = 'queue',
  onAddedWatched?: (item: ItemRow) => void,
) => {
  const { t, i18n } = useTranslation();

  return (title: string, movie?: MovieFields): string | null => {
    if (!list) return null;
    const existing = list.items.find((item) => normalizeTitle(item.title) === normalizeTitle(title));

    if (existing?.status === 'queue') {
      const queue = list.items.filter((item) => item.status === 'queue');
      return t('config.duplicateQueue', { position: queue.indexOf(existing) + 1 });
    }
    if (existing) {
      const date = formatDay(existing.watched_at ?? 0, i18n.language);
      return t('config.duplicateWatched', { status: t(`columns.${list.kind}.seenChip`, { date }) });
    }

    channel.addItem(list.id, title, status, movie).then((item) => {
      if (item && status === 'watched') onAddedWatched?.(item);
    });
    return null;
  };
};
