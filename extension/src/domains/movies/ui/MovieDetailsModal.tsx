import { Loader, Modal } from '@mantine/core';
import { IconExternalLink, IconStarFilled } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MovieDetails } from '@worker/tmdb';
import { callWorker } from '@shared/api/workerApi';
import Poster from '@shared/ui/Poster';

/** What the card needs to know about a title; everything else comes from TMDB. */
export interface DetailsTarget {
  tmdb_id: number;
  tmdb_type: 'movie' | 'tv' | null;
  title: string;
  poster_path: string | null;
  rating: number | null;
}

interface MovieDetailsModalProps {
  target: DetailsTarget | null;
  onClose: () => void;
}

/** A viewer clicked a title: poster, genres, length, TMDB score and the description. */
const MovieDetailsModal = ({ target, onClose }: MovieDetailsModalProps) => {
  const { t, i18n } = useTranslation();
  const [details, setDetails] = useState<MovieDetails | null>(null);
  const [isFailed, setIsFailed] = useState(false);

  useEffect(() => {
    setDetails(null);
    setIsFailed(false);
    if (!target) return;
    let isCancelled = false;
    const params = new URLSearchParams({ type: target.tmdb_type ?? 'movie', lang: i18n.language });
    callWorker<MovieDetails>('GET', `/api/movie/${target.tmdb_id}?${params}`)
      .then((nextDetails) => !isCancelled && setDetails(nextDetails))
      .catch(() => !isCancelled && setIsFailed(true));
    return () => {
      isCancelled = true;
    };
  }, [target, i18n.language]);

  const facts = details
    ? [
        details.year,
        details.runtime && t('details.minutes', { count: details.runtime }),
        details.seasons && t('details.seasons', { count: details.seasons }),
      ].filter(Boolean)
    : [];

  return (
    <Modal opened={!!target} onClose={onClose} fullScreen centered title={<span className="script text-3xl">{target?.title}</span>}>
      {target && (
        <div className="flex flex-col gap-3 pb-2">
          <div className="flex gap-3">
            <Poster path={details?.poster_path ?? target.poster_path} width={92} imageWidth={185} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
              {facts.length > 0 && <span className="font-bold text-fg-2">{facts.join(' · ')}</span>}
              {details && details.genres.length > 0 && <span className="text-fg-2">{details.genres.join(', ')}</span>}
              <div className="flex flex-wrap items-center gap-2">
                {details?.rating && (
                  <span className="chip chip-queue inline-flex items-center gap-1">
                    <IconStarFilled size={11} />
                    {details.rating.toLocaleString(i18n.language)} TMDB
                  </span>
                )}
                {target.rating && <span className="chip chip-new">{t('details.streamerRating', { rating: target.rating })}</span>}
              </div>
            </div>
          </div>

          {!details && !isFailed && (
            <div className="flex justify-center py-6">
              <Loader color="var(--primary-hi)" size="sm" />
            </div>
          )}
          {isFailed && <p className="text-sm text-fg-2">{t('details.failed')}</p>}
          {details?.tagline && <p className="text-sm font-bold italic text-fg-2">{details.tagline}</p>}
          {details && (
            <p className="text-sm leading-relaxed text-fg">{details.overview ?? t('details.noOverview')}</p>
          )}

          {details && (
            <a
              href={details.tmdb_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--primary-hi)]"
            >
              {t('details.openTmdb')}
              <IconExternalLink size={14} />
            </a>
          )}
          <p className="text-[11px] text-fg-3">{t('details.attribution')}</p>
        </div>
      )}
    </Modal>
  );
};

export default MovieDetailsModal;
