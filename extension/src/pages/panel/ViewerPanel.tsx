import { ActionIcon, CloseButton, Loader, ScrollArea, SegmentedControl, TextInput } from '@mantine/core';
import { IconPencil, IconSearch } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDay, groupByMonth } from '@domains/lists/lib/items';
import type { PanelItem, PanelList, PanelStatus } from '@domains/lists/lib/panelLists';
import { searchOnServer, usePanelLists, type PageState, type Search } from '@domains/lists/model/usePanelLists';
import { Points, RatingBadge } from '@domains/lists/ui/ItemMeta';
import ListSwitcher from '@domains/lists/ui/ListSwitcher';
import PanelRow from '@domains/lists/ui/PanelRow';
import PanelSearchResults from '@domains/lists/ui/PanelSearchResults';
import MovieDetailsModal, { type DetailsTarget } from '@domains/movies/ui/MovieDetailsModal';
import AuthorCredit from '@shared/ui/AuthorCredit';
import Poster from '@shared/ui/Poster';
import { useWhenVisible } from '@shared/ui/useWhenVisible';

const Empty = ({ text }: { text: string }) => <p className="px-3 py-8 text-center text-sm text-fg-3">{text}</p>;

type OpenDetails = (item: PanelItem) => void;

const ROW_CLASS = 'flex min-h-[50px] w-full items-center py-1 gap-2.5 rounded-xl px-1.5 text-left text-[13px] font-bold';

const QueueRows = ({ list, onOpen }: { list: PanelList; onOpen: OpenDetails }) =>
  list.queue.map((item, index) => (
    <PanelRow key={item.id} item={item} onOpen={onOpen} className={`${ROW_CLASS} ${item.tmdb_id ? 'hover:selected' : ''}`}>
      <span className="w-3.5 shrink-0 text-right text-[11px] text-fg-3 tabular-nums">{index + 1}</span>
      <Poster path={item.poster_path} width={24} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 leading-tight">{item.title}</span>
        <span className="min-h-[12px] text-[11px] font-semibold text-fg-3 tabular-nums">{item.year}</span>
      </span>
      <Points value={item.points} />
    </PanelRow>
  ));

const WatchedRows = ({ list, onOpen }: { list: PanelList; onOpen: OpenDetails }) => {
  const { i18n } = useTranslation();

  return groupByMonth(list.watched, i18n.language).map((month) => (
    <div key={month.key}>
      <div className="flex justify-between px-2 pt-2.5 pb-1">
        <span className="label">{month.title}</span>
        <span className="label">{month.items.length}</span>
      </div>
      {month.items.map((item) => (
        <PanelRow key={item.id} item={item} onOpen={onOpen} className={`${ROW_CLASS} ${item.tmdb_id ? 'hover:selected' : ''}`}>
          <span className="flex opacity-70">
            <Poster path={item.poster_path} width={24} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="line-clamp-2 leading-tight">{item.title}</span>
            <span className="min-h-[12px] text-[11px] font-semibold text-fg-3 tabular-nums">{item.year}</span>
          </span>
          <span className="text-[11px] font-semibold text-fg-3">{item.watched_at && formatDay(item.watched_at, i18n.language)}</span>
          <RatingBadge rating={item.rating} />
        </PanelRow>
      ))}
    </div>
  ));
};

/** The end of what is loaded: the next page comes as it scrolls into view (or on click); a failure offers a retry. */
const MoreRows = ({ count, state, onLoad }: { count: number; state: PageState | undefined; onLoad: () => void }) => {
  const { t } = useTranslation();
  const ref = useWhenVisible<HTMLDivElement>(onLoad, { key: count, enabled: !state });

  return (
    <div ref={ref} className="flex justify-center py-2 text-xs font-bold text-[var(--primary-text)]">
      {state === 'loading' ? (
        <Loader color="var(--primary-hi)" size="xs" aria-label={t('panel.loading')} />
      ) : (
        <button type="button" onClick={onLoad}>
          {state === 'failed' ? `${t('panel.loadFailed')} ${t('panel.retry')}` : t('panel.more', { count })}
        </button>
      )}
    </div>
  );
};

const Count = ({ label, count }: { label: string; count: number }) => (
  <>
    {label}
    <span className="ml-1 font-semibold text-fg-3">{count}</span>
  </>
);

interface ViewerPanelViewProps {
  lists: PanelList[] | null;
  search: Search;
  /** The next page of a list's queue or history; none when `lists` are complete (the streamer's preview). */
  loadMore?: (list: PanelList, status: PanelStatus) => void;
  pageState?: (listId: number, status: PanelStatus) => PageState | undefined;
  /** The streamer previewing the viewer's view gets a way back to editing. */
  onEdit?: () => void;
}

/** What viewers see: lists, the queue / history tabs, search and the details card. */
export const ViewerPanelView = ({ lists, search, loadMore, pageState, onEdit }: ViewerPanelViewProps) => {
  const { t } = useTranslation();
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [tab, setTab] = useState<PanelStatus>('queue');
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState<DetailsTarget | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const openDetails = (item: PanelItem) => {
    if (item.tmdb_id) setDetails({ ...item, tmdb_id: item.tmdb_id });
  };

  if (!lists) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader color="var(--primary-hi)" size="sm" aria-label={t('panel.loading')} />
      </div>
    );
  }
  const list = lists.find((candidate) => candidate.id === activeListId) ?? lists[0];
  if (!list) return <Empty text={t('panel.empty')} />;

  const isSearching = !!query.trim();
  const shown = list[tab];
  const total = tab === 'queue' ? list.queueCount : list.watchedCount;
  const hasMore = !!loadMore && shown.length < total && pageState?.(list.id, tab) !== 'end';

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
          ref={searchRef}
          className="ml-auto w-[150px] shrink-0"
          size="xs"
          leftSection={<IconSearch size={14} />}
          rightSectionPointerEvents="all"
          rightSection={
            isSearching && (
              <CloseButton
                size="sm"
                aria-label={t('panel.clear')}
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              />
            )
          }
          placeholder={t(list.kind === 'movies' ? 'panel.searchMovies' : 'panel.search')}
          aria-label={t(list.kind === 'movies' ? 'panel.searchMovies' : 'panel.search')}
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
        <PanelSearchResults list={list} query={query} search={search} onOpen={openDetails} />
      ) : (
        <>
          <SegmentedControl
            size="xs"
            fullWidth
            value={tab}
            onChange={(value) => setTab(value as PanelStatus)}
            data={[
              { value: 'queue', label: <Count label={t('columns.queue')} count={list.queueCount} /> },
              { value: 'watched', label: <Count label={t(`columns.${list.kind}.watched`)} count={list.watchedCount} /> },
            ]}
          />
          <ScrollArea className="glass-soft min-h-0 flex-1 rounded-[18px]" p={6}>
            {/* "Empty" only when it is: a snapshot may hold none of a long list's items. */}
            {!total && <Empty text={t(tab === 'queue' ? 'panel.emptyQueue' : `columns.${list.kind}.emptyWatched`)} />}
            {tab === 'queue' ? <QueueRows list={list} onOpen={openDetails} /> : <WatchedRows list={list} onOpen={openDetails} />}
            {hasMore && <MoreRows count={total - shown.length} state={pageState?.(list.id, tab)} onLoad={() => loadMore?.(list, tab)} />}
          </ScrollArea>
        </>
      )}

      <AuthorCredit />

      <MovieDetailsModal target={details} onClose={() => setDetails(null)} />
    </div>
  );
};

/** The viewers' panel: the snapshot from Twitch right away, more from the Worker as it is needed. */
const ViewerPanel = () => {
  const { lists, loadMore, pageState } = usePanelLists();
  return <ViewerPanelView lists={lists} search={searchOnServer} loadMore={loadMore} pageState={pageState} />;
};

export default ViewerPanel;
