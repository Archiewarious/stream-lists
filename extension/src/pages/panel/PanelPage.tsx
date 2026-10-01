import { CloseButton, Loader, Menu, ScrollArea, SegmentedControl, TextInput } from '@mantine/core';
import { IconChevronDown, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDay, groupByMonth } from '@domains/lists/lib/items';
import { checkIsTrimmed, type PanelList } from '@domains/lists/lib/panelLists';
import { usePanelLists } from '@domains/lists/model/usePanelLists';
import KindIcon from '@domains/lists/ui/KindIcon';
import PanelSearchResults from '@domains/lists/ui/PanelSearchResults';
import Poster from '@shared/ui/Poster';

type Tab = 'queue' | 'watched';

const Empty = ({ text }: { text: string }) => <p className="px-3 py-8 text-center text-sm text-fg-3">{text}</p>;

const QueueRows = ({ list }: { list: PanelList }) => {
  const { t } = useTranslation();
  if (!list.queue.length) return <Empty text={t('panel.emptyQueue')} />;

  return list.queue.map((item, index) => (
    <div key={item.id} className="flex h-[46px] items-center gap-2.5 rounded-xl px-1.5 text-[13px] font-bold">
      <span className="w-3.5 shrink-0 text-right text-[11px] text-fg-3 tabular-nums">{index + 1}</span>
      <Poster path={item.poster_path} width={24} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.year && <span className="text-xs text-fg-3 tabular-nums">{item.year}</span>}
    </div>
  ));
};

const WatchedRows = ({ list }: { list: PanelList }) => {
  const { t, i18n } = useTranslation();
  if (!list.watched.length) return <Empty text={t(`columns.${list.kind}.emptyWatched`)} />;

  return groupByMonth(list.watched, i18n.language).map((month) => (
    <div key={month.key}>
      <div className="flex justify-between px-2 pt-2 pb-1">
        <span className="label">{month.title}</span>
        <span className="label">{month.items.length}</span>
      </div>
      {month.items.map((item) => (
        <div key={item.id} className="flex h-[46px] items-center gap-2.5 rounded-xl px-1.5 text-[13px] font-bold">
          <span className="opacity-70">
            <Poster path={item.poster_path} width={24} />
          </span>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <span className="text-[11px] text-fg-3">{item.watched_at && formatDay(item.watched_at, i18n.language)}</span>
        </div>
      ))}
    </div>
  ));
};

const PanelPage = () => {
  const { t } = useTranslation();
  const { lists, isFull, loadFull } = usePanelLists();
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
  const [query, setQuery] = useState('');

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
        <Menu position="bottom-start" disabled={lists.length < 2}>
          <Menu.Target>
            <button type="button" className="script flex min-w-0 items-center gap-1.5 pl-0.5 text-[30px]">
              <span className="truncate leading-[1.2]">{list.title}</span>
              {lists.length > 1 && <IconChevronDown size={14} className="shrink-0 text-fg-2" />}
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            {lists.map((candidate) => (
              <Menu.Item
                key={candidate.id}
                leftSection={<KindIcon kind={candidate.kind} />}
                onClick={() => {
                  setActiveListId(candidate.id);
                  setQuery('');
                }}
              >
                {candidate.title}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <TextInput
          className="ml-auto w-[150px] shrink-0"
          size="xs"
          leftSection={<IconSearch size={14} />}
          rightSection={isSearching && <CloseButton size="sm" aria-label={t('panel.clear')} onClick={() => setQuery('')} />}
          placeholder={t(list.kind === 'movies' ? 'panel.searchMovies' : 'panel.search')}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {isSearching ? (
        <PanelSearchResults list={list} query={query} />
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
            {tab === 'queue' ? <QueueRows list={list} /> : <WatchedRows list={list} />}
            {tab === 'queue' && hiddenQueueCount > 0 && (
              <button type="button" className="w-full py-2 text-xs font-bold text-[var(--primary-hi)]" onClick={loadFull}>
                {t('panel.more', { count: hiddenQueueCount })}
              </button>
            )}
          </ScrollArea>
        </>
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

export default PanelPage;
