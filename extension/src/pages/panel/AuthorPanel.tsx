import { ActionIcon, Alert, CloseButton, Loader, ScrollArea, SegmentedControl, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconEye, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import { matchesTitle } from '@domains/lists/lib/items';
import { useAddItem } from '@domains/lists/model/useAddItem';
import type { Channel, ItemStatus } from '@domains/lists/model/useChannel';
import AddItemBar from '@domains/lists/ui/AddItemBar';
import PendingLotsModal from '@domains/integrations/pointauc/ui/PendingLotsModal';
import ItemEditModal from '@domains/lists/ui/ItemEditModal';
import RatePromptModal from '@domains/lists/ui/RatePromptModal';
import { QueueList, WatchedList } from '@domains/lists/ui/ItemLists';
import ListSwitcher from '@domains/lists/ui/ListSwitcher';

type Tab = 'queue' | 'watched';

interface AuthorPanelProps {
  /** The streamer's lists; owned by PanelPage so the viewer preview shows the same live data. */
  channel: Channel;
  /** Shows the panel the way viewers see it. */
  onViewAsViewer: () => void;
}

/** The streamer's panel on the channel page: the same lists, editable right there. Writes are checked by the Worker. */
const AuthorPanel = ({ channel, onViewAsViewer }: AuthorPanelProps) => {
  const { t } = useTranslation();
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isPendingOpened, setIsPendingOpened] = useState(false);
  const [ratingId, setRatingId] = useState<number | null>(null);

  const list = channel.lists?.find((candidate) => candidate.id === activeListId) ?? channel.lists?.[0];
  // A title typed in goes where the streamer is looking: the open tab.
  const addItem = useAddItem(channel, list, tab === 'watched' ? 'watched' : 'queue', (item) => setRatingId(item.id));

  if (!channel.lists) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        {channel.loadError ? <p className="text-sm text-fg-2">{t('config.loadFailed', { error: channel.loadError })}</p> : <Loader color="var(--primary-hi)" size="sm" />}
      </div>
    );
  }
  if (!list) return <p className="px-4 py-10 text-center text-sm text-fg-2">{t('panel.noListsAuthor')}</p>;

  const found = list.items.filter((item) => matchesTitle(item.title, query));
  const queue = found.filter((item) => item.status === 'queue');
  const watched = found.filter((item) => item.status === 'watched');
  const total = (status: ItemStatus) => list.items.filter((item) => item.status === status).length;
  const isSearching = !!query.trim();
  const pendingLots = channel.pendingLots.filter((lot) => lot.list_id === list.id);

  const actions = {
    onWatched: (itemId: number) => {
      channel.setStatus(itemId, 'watched');
      setRatingId(itemId); // and ask how it was
    },
    onRequeue: (itemId: number) => channel.setStatus(itemId, 'queue'),
    onDelete: channel.deleteItem,
    onEdit: (item: ItemRow) => setEditingId(item.id),
    onRate: (itemId: number, rating: number | null) => channel.editItem(itemId, { rating }),
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <ListSwitcher
          lists={channel.lists}
          active={list}
          onSelect={(listId) => {
            setActiveListId(listId);
            setQuery('');
          }}
        />
        <TextInput
          className="ml-auto w-[112px] shrink-0"
          size="xs"
          leftSection={<IconSearch size={14} />}
          rightSection={isSearching && <CloseButton size="sm" aria-label={t('panel.clear')} onClick={() => setQuery('')} />}
          placeholder={t('config.search')}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <ActionIcon variant="default" size="lg" aria-label={t('panel.viewAsViewer')} title={t('panel.viewAsViewer')} onClick={onViewAsViewer}>
          <IconEye size={16} />
        </ActionIcon>
      </div>

      <AddItemBar
        kind={list.kind}
        isCompact
        target={tab}
        onAdd={addItem}
      />

      {channel.saveError && (
        <Alert color="red" p="xs" icon={<IconAlertTriangle size={14} />} withCloseButton onClose={channel.clearSaveError}>
          <span className="text-xs">{t('config.saveFailed', { error: channel.saveError })}</span>
        </Alert>
      )}

      {pendingLots.length > 0 && (
        <button
          type="button"
          className="chip chip-new self-start"
          onClick={() => setIsPendingOpened(true)}
        >
          {t('pending.banner', { count: pendingLots.length })}
        </button>
      )}

      <SegmentedControl
        size="xs"
        fullWidth
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        data={[
          { value: 'queue', label: `${t('columns.queue')} ${total('queue')}` },
          { value: 'watched', label: `${t(`columns.${list.kind}.watched`)} ${total('watched')}` },
        ]}
      />

      <ScrollArea className="glass-soft min-h-0 flex-1 rounded-[18px]" p={6}>
        {tab === 'queue' ? (
          <QueueList
            kind={list.kind}
            items={queue}
            isCompact
            emptyText={t(isSearching ? 'config.nothingFound' : 'config.emptyQueue')}
            onReorder={(ids) => channel.reorderQueue(list.id, ids)}
            {...actions}
          />
        ) : (
          <WatchedList
            items={watched}
            isCompact
            emptyText={t(isSearching ? 'config.nothingFound' : 'config.emptyWatched')}
            {...actions}
          />
        )}
      </ScrollArea>

      <PendingLotsModal
        opened={isPendingOpened && pendingLots.length > 0}
        onClose={() => setIsPendingOpened(false)}
        lots={pendingLots}
        withSuggestions={list.kind === 'movies'}
        isFullScreen
        onAccept={channel.acceptPending}
        onDismiss={channel.dismissPending}
      />

      <RatePromptModal
        item={list.items.find((item) => item.id === ratingId) ?? null}
        isFullScreen
        onRate={(itemId, rating) => channel.editItem(itemId, { rating })}
        onClose={() => setRatingId(null)}
      />

      <ItemEditModal
        item={list.items.find((item) => item.id === editingId) ?? null}
        kind={list.kind}
        isFullScreen
        onClose={() => setEditingId(null)}
        onSave={channel.editItem}
      />
    </div>
  );
};

export default AuthorPanel;
