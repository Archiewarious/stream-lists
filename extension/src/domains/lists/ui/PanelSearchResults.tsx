import { Loader } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { normalizeTitle } from '@worker/pointauc';
import { formatDay } from '@domains/lists/lib/items';
import type { PanelItem, PanelList } from '@domains/lists/lib/panelLists';
import { usePanelSearch, type Search } from '@domains/lists/model/usePanelLists';
import PanelRow from '@domains/lists/ui/PanelRow';
import Poster from '@shared/ui/Poster';

interface PanelSearchResultsProps {
  list: PanelList;
  query: string;
  search: Search;
  onOpen: (item: PanelItem) => void;
}

/** Marks the query in the title, matched the way the search matches (case, ё/е); no mark where that cannot be mapped back. */
const Highlight = ({ text, query }: { text: string; query: string }) => {
  const normalized = normalizeTitle(text);
  const start = normalized.indexOf(normalizeTitle(query));
  // normalizeTitle may change the length (İ, collapsed spaces): then positions would not point at the same letters.
  if (start < 0 || normalized.length !== text.length) return text;
  const end = start + normalizeTitle(query).length;
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-transparent font-extrabold text-[var(--primary-text)]">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
};

/** "А это уже смотрели?" — matches from the history and the queue with their status, searched on the server. */
const PanelSearchResults = ({ list, query, search, onOpen }: PanelSearchResultsProps) => {
  const { t, i18n } = useTranslation();
  const { answer, isLoading, isFailed, retry } = usePanelSearch(search, list.id, query);
  const trimmedQuery = query.trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <p className="flex items-center gap-2 px-1.5 text-xs text-fg-2" aria-live="polite">
        {isFailed ? (
          <>
            {t('panel.loadFailed')}
            <button type="button" className="font-bold text-[var(--primary-text)]" onClick={retry}>
              {t('panel.retry')}
            </button>
          </>
        ) : !answer ? null : answer.total ? (
          t('panel.found', { count: answer.total, total: list.queueCount + list.watchedCount })
        ) : (
          t(`columns.${list.kind}.notFound`)
        )}
        {isLoading && <Loader color="var(--primary-hi)" size={12} />}
      </p>
      {answer?.results.map((item) => (
        <PanelRow key={item.id} item={item} onOpen={onOpen} className="glass flex items-center gap-2.5 rounded-2xl p-2 text-[13px] font-bold">
          <Poster path={item.poster_path} width={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              <Highlight text={item.title} query={trimmedQuery} />
            </div>
            {item.year && <div className="mt-0.5 text-xs font-semibold text-fg-3">{item.year}</div>}
          </div>
          {item.status === 'queue' ? (
            <span className="chip">{t('panel.inQueue', { position: item.place })}</span>
          ) : (
            <span className="chip chip-seen">{t(`columns.${list.kind}.seenChip`, { date: formatDay(item.watched_at ?? 0, i18n.language) })}</span>
          )}
        </PanelRow>
      ))}
      {answer && answer.total > answer.results.length && (
        <p className="px-1.5 pb-1 text-xs text-fg-3">{t('panel.refine', { count: answer.results.length })}</p>
      )}
    </div>
  );
};

export default PanelSearchResults;
