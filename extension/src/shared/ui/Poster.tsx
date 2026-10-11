const TMDB_IMAGES = 'https://image.tmdb.org/t/p';

interface PosterProps {
  /** TMDB poster_path, e.g. "/abc.jpg"; none — an empty tile. */
  path?: string | null;
  width: number;
  /** TMDB image width to download: 92 for rows, 185 for the details card. */
  imageWidth?: 92 | 185;
}

/** Movie poster, 2:3. */
const Poster = ({ path, width, imageWidth = 92 }: PosterProps) => {
  const height = Math.round(width * 1.5);

  return path ? (
    <img className="poster" src={`${TMDB_IMAGES}/w${imageWidth}${path}`} width={width} height={height} alt="" loading="lazy" />
  ) : (
    <span className="poster" style={{ width, height }} />
  );
};

export default Poster;
