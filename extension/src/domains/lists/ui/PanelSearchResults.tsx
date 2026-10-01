import { useTranslation } from 'react-i18next';

import { formatDay, matchesTitle } from '@domains/lists/lib/items';
import type { PanelList } from '@domains/lists/lib/panelLists';
import Poster from '@shared/ui/Poster';

interface PanelSearchResultsProps {
  list: PanelList;
  query: string;
}

const Highlight = ({ text, query }: { text: string; query: string }) => {
  const start = text.toLowerCase().indexOf(query.toLowerCase());
  if (start < 0) return text;
  const end = start + query.length;
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-transparent font-extrabold text-[var(--primary-hi)]">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
};

/** "А это уже смотрели?" — matches from the queue and the history with their status. */
const PanelSearchResults = ({ list, query }: PanelSearchResultsProps) => {
  const { t, i18n } = useTranslation();
  const trimmedQuery = query.trim();

  const results = [
    ...list.watched.map((item) => ({
      item,
      chip: <span className="chip chip-seen">{t(`columns.${list.kind}.seenChip`, { date: formatDay(item.watched_at ?? 0, i18n.language) })}</span>,
    })),
    ...list.queue.map((item, index) => ({
      item,
      chip: <span className="chip chip-queue">{t('panel.inQueue', { position: index + 1 })}</span>,
    })),
  ].filter(({ item }) => matchesTitle(item.title, trimmedQuery));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <p className="px-1.5 text-xs text-fg-2">
        {results.length
          ? t('panel.found', { count: results.length, total: list.queueCount + list.watchedCount })
          : t(`columns.${list.kind}.notFound`)}
      </p>
      {results.map(({ item, chip }) => (
        <div key={item.id} className="glass flex items-center gap-2.5 rounded-2xl p-2 text-[13px] font-bold">
          <Poster path={item.poster_path} width={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              <Highlight text={item.title} query={trimmedQuery} />
            </div>
            {item.year && <div className="mt-0.5 text-xs font-semibold text-fg-3">{item.year}</div>}
          </div>
          {chip}
        </div>
      ))}
    </div>
  );
};

export default PanelSearchResults;
