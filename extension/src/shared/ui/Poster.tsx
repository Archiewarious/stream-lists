const TMDB_IMAGES = 'https://image.tmdb.org/t/p/w92';

interface PosterProps {
  /** TMDB poster_path, e.g. "/abc.jpg"; none — an empty tile. */
  path?: string | null;
  width: number;
}

/** Movie poster, 2:3. */
const Poster = ({ path, width }: PosterProps) => {
  const height = Math.round(width * 1.5);

  return path ? (
    <img className="poster" src={TMDB_IMAGES + path} width={width} height={height} alt="" loading="lazy" />
  ) : (
    <span className="poster" style={{ width, height }} />
  );
};

export default Poster;
