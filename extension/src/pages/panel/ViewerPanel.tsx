import { ActionIcon, CloseButton, Loader, ScrollArea, SegmentedControl, TextInput } from '@mantine/core';
import { IconPencil, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDay, groupByMonth } from '@domains/lists/lib/items';
import { checkIsTrimmed, type PanelItem, type PanelList } from '@domains/lists/lib/panelLists';
import { usePanelLists } from '@domains/lists/model/usePanelLists';
import { Points, RatingBadge } from '@domains/lists/ui/ItemMeta';
import ListSwitcher from '@domains/lists/ui/ListSwitcher';
import PanelSearchResults from '@domains/lists/ui/PanelSearchResults';
import MovieDetailsModal, { type DetailsTarget } from '@domains/movies/ui/MovieDetailsModal';
import AuthorCredit from '@shared/ui/AuthorCredit';
import Poster from '@shared/ui/Poster';

type Tab = 'queue' | 'watched';

const Empty = ({ text }: { text: string }) => <p className="px-3 py-8 text-center text-sm text-fg-3">{text}</p>;

type OpenDetails = (item: PanelItem) => void;

/** A row is a button when TMDB knows the title: its card opens on click. */
const rowClass = (item: PanelItem) =>
  `flex min-h-[50px] w-full items-center py-1 gap-2.5 rounded-xl px-1.5 text-left text-[13px] font-bold ${
    item.tmdb_id ? 'cursor-pointer hover:selected' : ''
  }`;

const QueueRows = ({ list, onOpen }: { list: PanelList; onOpen: OpenDetails }) => {
  const { t } = useTranslation();
  if (!list.queue.length) return <Empty text={t('panel.emptyQueue')} />;

  return list.queue.map((item, index) => (
    <div
      key={item.id}
      role={item.tmdb_id ? 'button' : undefined}
      tabIndex={item.tmdb_id ? 0 : undefined}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => event.key === 'Enter' && onOpen(item)}
      className={rowClass(item)}
    >
      <span className="w-3.5 shrink-0 text-right text-[11px] text-fg-3 tabular-nums">{index + 1}</span>
      <Poster path={item.poster_path} width={24} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 leading-tight">{item.title}</span>
        <span className="min-h-[12px] text-[11px] font-semibold text-fg-3 tabular-nums">{item.year}</span>
      </span>
      <Points value={item.points} />
    </div>
  ));
};

const WatchedRows = ({ list, onOpen }: { list: PanelList; onOpen: OpenDetails }) => {
  const { t, i18n } = useTranslation();
  if (!list.watched.length) return <Empty text={t(`columns.${list.kind}.emptyWatched`)} />;

  return groupByMonth(list.watched, i18n.language).map((month) => (
    <div key={month.key}>
      <div className="flex justify-between px-2 pt-2 pb-1">
        <span className="label">{month.title}</span>
        <span className="label">{month.items.length}</span>
      </div>
      {month.items.map((item) => (
        <div
          key={item.id}
          role={item.tmdb_id ? 'button' : undefined}
          tabIndex={item.tmdb_id ? 0 : undefined}
          onClick={() => onOpen(item)}
          onKeyDown={(event) => event.key === 'Enter' && onOpen(item)}
          className={rowClass(item)}
        >
          <span className="opacity-70">
            <Poster path={item.poster_path} width={24} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="line-clamp-2 leading-tight">{item.title}</span>
            <span className="min-h-[12px] text-[11px] font-semibold text-fg-3 tabular-nums">{item.year}</span>
          </span>
          <span className="text-[11px] font-semibold text-fg-3">
            {item.watched_at && formatDay(item.watched_at, i18n.language)}
          </span>
          <RatingBadge rating={item.rating} />
        </div>
      ))}
    </div>
  ));
};

const Count = ({ label, count }: { label: string; count: number }) => (
  <>
    {label}
    <span className="ml-1 font-semibold text-fg-3">{count}</span>
  </>
);

interface ViewerPanelProps {
  /**
   * Lists to show instead of Twitch's snapshot: the streamer's preview uses the live data from the Worker, because
   * the snapshot the Twitch helper holds is only as fresh as the page load.
   */
  lists?: PanelList[] | null;
  /** The streamer previewing the viewer's view gets a way back to editing. */
  onEdit?: () => void;
}

/** What viewers see: the snapshot from Twitch right away, the full history from the Worker when needed. */
const ViewerPanel = ({ onEdit, lists: liveLists }: ViewerPanelProps) => {
  const { t } = useTranslation();
  const snapshot = usePanelLists();
  const lists = liveLists === undefined ? snapshot.lists : liveLists;
  const isFull = liveLists === undefined ? snapshot.isFull : true;
  const { loadFull } = snapshot;
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState<DetailsTarget | null>(null);

  const openDetails = (item: PanelItem) => {
    if (item.tmdb_id) setDetails({ ...item, tmdb_id: item.tmdb_id });
  };

  const list = lists?.find((candidate) => candidate.id === activeListId) ?? lists?.[0];
  const isSearching = !!query.trim();
  // The snapshot holds the queue start and the latest watched; the rest comes from the Worker when asked for.
  const needsFull = !!list && !isFull && checkIsTrimmed(list) && (isSearching || tab === 'watched');

  useEffect(() => {
    if (needsFull) loadFull();
  }, [needsFull, loadFull]);

  if (!lists) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader color="var(--primary-hi)" size="sm" />
      </div>
    );
  }
  if (!list) return <Empty text={t('panel.empty')} />;

  const hiddenQueueCount = list.queueCount - list.queue.length;

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2">
        <ListSwitcher
          lists={lists}
          active={list}
          onSelect={(listId) => {
            setActiveListId(listId);
            setQuery('');
          }}
        />
        <TextInput
          className="ml-auto w-[150px] shrink-0"
          size="xs"
          leftSection={<IconSearch size={14} />}
          rightSection={isSearching && <CloseButton size="sm" aria-label={t('panel.clear')} onClick={() => setQuery('')} />}
          placeholder={t(list.kind === 'movies' ? 'panel.searchMovies' : 'panel.search')}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {onEdit && (
          <ActionIcon variant="default" size="lg" aria-label={t('panel.backToEdit')} title={t('panel.backToEdit')} onClick={onEdit}>
            <IconPencil size={16} />
          </ActionIcon>
        )}
      </div>

      {isSearching ? (
        <PanelSearchResults list={list} query={query} onOpen={openDetails} />
      ) : (
        <>
          <SegmentedControl
            size="xs"
            fullWidth
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            data={[
              { value: 'queue', label: <Count label={t('columns.queue')} count={list.queueCount} /> },
              { value: 'watched', label: <Count label={t(`columns.${list.kind}.watched`)} count={list.watchedCount} /> },
            ]}
          />
          <ScrollArea className="glass-soft min-h-0 flex-1 rounded-[18px]" p={6}>
            {tab === 'queue' ? <QueueRows list={list} onOpen={openDetails} /> : <WatchedRows list={list} onOpen={openDetails} />}
            {tab === 'queue' && hiddenQueueCount > 0 && (
              <button type="button" className="w-full py-2 text-xs font-bold text-[var(--primary-hi)]" onClick={loadFull}>
                {t('panel.more', { count: hiddenQueueCount })}
              </button>
            )}
          </ScrollArea>
        </>
      )}

      <AuthorCredit />

      <MovieDetailsModal target={details} onClose={() => setDetails(null)} />
    </div>
  );
};

export default ViewerPanel;
