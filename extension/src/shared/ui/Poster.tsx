import { useState } from 'react';

import { useWhenVisible } from '@shared/ui/useWhenVisible';

const TMDB_IMAGES = 'https://image.tmdb.org/t/p';

interface PosterProps {
  /** TMDB poster_path, e.g. "/abc.jpg"; none — an empty tile. */
  path?: string | null;
  width: number;
  /** TMDB image width to download: 92 (TMDB's smallest) for rows, 185 for the details card. */
  imageWidth?: 92 | 185;
}

/** Movie poster, 2:3. Downloaded only once its row scrolls into view. */
const Poster = ({ path, width, imageWidth = 92 }: PosterProps) => {
  const height = Math.round(width * 1.5);
  const [isNear, setIsNear] = useState(false);
  const ref = useWhenVisible<HTMLSpanElement>(() => setIsNear(true), { enabled: !!path && !isNear });

  return path && isNear ? (
    <img className="poster" src={`${TMDB_IMAGES}/w${imageWidth}${path}`} width={width} height={height} alt="" />
  ) : (
    <span ref={ref} className="poster" style={{ width, height }} />
  );
};

export default Poster;
