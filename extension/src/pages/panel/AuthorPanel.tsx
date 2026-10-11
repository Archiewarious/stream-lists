import { ActionIcon, Alert, Indicator, Loader, ScrollArea, SegmentedControl } from '@mantine/core';
import { IconAlertTriangle, IconEye, IconListCheck, IconSettings } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AuthorCredit from '@shared/ui/AuthorCredit';
import SearchField from '@shared/ui/SearchField';
import { matchesTitle } from '@domains/lists/lib/items';
import { useAddItem } from '@domains/lists/model/useAddItem';
import { streamerActions, type Channel, type ItemStatus } from '@domains/lists/model/useChannel';
import AddItemBar from '@domains/lists/ui/AddItemBar';
import PendingLotsModal from '@domains/integrations/pointauc/ui/PendingLotsModal';
import PointaucImportModal from '@domains/integrations/pointauc/ui/PointaucImportModal';
import ItemEditModal from '@domains/lists/ui/ItemEditModal';
import RatePromptModal from '@domains/lists/ui/RatePromptModal';
import { QueueList, WatchedList } from '@domains/lists/ui/ItemLists';
import ListSwitcher from '@domains/lists/ui/ListSwitcher';

type Tab = 'queue' | 'watched';

interface AuthorPanelProps {
  /** The streamer's lists; owned by PanelPage so the viewer preview shows the same live data. */
  channel: Channel;
  /** Why the latest Pointauc sync pass failed (null — it did not). */
  syncError: string | null;
  /** Shows the panel the way viewers see it. */
  onViewAsViewer: () => void;
}

/** The streamer's panel on the channel page: the same lists, editable right there. Writes are checked by the Worker. */
const AuthorPanel = ({ channel, syncError, onViewAsViewer }: AuthorPanelProps) => {
  const { t } = useTranslation();
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isPendingOpened, setIsPendingOpened] = useState(false);
  const [isPointaucOpened, setIsPointaucOpened] = useState(false);
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
  // A search shows some of the queue: each row keeps its number in the whole queue.
  const places = new Map(list.items.filter((item) => item.status === 'queue').map((item, index) => [item.id, index + 1]));
  const actions = streamerActions(channel, setRatingId, setEditingId);
  const syncList = channel.lists.find((candidate) => candidate.id === channel.pointaucListId);
  const settingsLabel = syncError ? `${t('panel.pointaucSettings')} — ${syncError}` : t('panel.pointaucSettings');

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5">
        <ListSwitcher
          lists={channel.lists}
          active={list}
          onSelect={(listId) => {
            setActiveListId(listId);
            setQuery('');
          }}
        />
        <SearchField className="ml-auto w-[76px] shrink-0" label={t('config.search')} value={query} onChange={setQuery} />
        {/* The dot: Pointauc is not connected yet, or the sync cannot reach it. */}
        <Indicator size={9} offset={4} color="var(--accent)" disabled={channel.isPointaucConnected && !syncError}>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label={settingsLabel}
            title={settingsLabel}
            onClick={() => setIsPointaucOpened(true)}
          >
            <IconSettings size={16} />
          </ActionIcon>
        </Indicator>
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

      {/* Lots to look at sit next to the tabs, so the 300 px panel keeps its room for the list. */}
      <div className="flex items-center gap-1.5">
        <SegmentedControl
          className="min-w-0 flex-1"
          size="xs"
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          data={[
            { value: 'queue', label: `${t('columns.queue')} ${total('queue')}` },
            { value: 'watched', label: `${t(`columns.${list.kind}.watched`)} ${total('watched')}` },
          ]}
        />
        {pendingLots.length > 0 && (
          <button
            type="button"
            className="chip chip-new inline-flex shrink-0 items-center gap-1"
            aria-label={t('pending.banner', { count: pendingLots.length })}
            title={t('pending.banner', { count: pendingLots.length })}
            onClick={() => setIsPendingOpened(true)}
          >
            <IconListCheck size={12} />
            {pendingLots.length}
          </button>
        )}
      </div>

      <ScrollArea className="glass-soft min-h-0 flex-1 rounded-[18px]" p={6}>
        {tab === 'queue' ? (
          <QueueList
            kind={list.kind}
            items={queue}
            isCompact
            emptyText={t(isSearching ? 'config.nothingFound' : 'config.emptyQueue')}
            places={places}
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

      <AuthorCredit />

      <PendingLotsModal
        opened={isPendingOpened && pendingLots.length > 0}
        onClose={() => setIsPendingOpened(false)}
        lots={pendingLots}
        withSuggestions={list.kind === 'movies'}
        isFullScreen
        onAccept={channel.acceptPending}
        onDismiss={channel.dismissPending}
      />

      <PointaucImportModal
        opened={isPointaucOpened}
        onClose={() => setIsPointaucOpened(false)}
        listId={list.id}
        kind={list.kind}
        isFullScreen
        isConnected={channel.isPointaucConnected}
        onConnect={channel.connectPointauc}
        onDisconnect={channel.disconnectPointauc}
        syncListId={channel.pointaucListId}
        syncListTitle={syncList?.title ?? null}
        syncError={syncError}
        saveError={channel.saveError}
        onToggleSync={(isOn) => channel.setPointaucSync(isOn ? list.id : null)}
        onImport={async (lotIds, status) => !!(await channel.importLots(list.id, lotIds, status))}
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
