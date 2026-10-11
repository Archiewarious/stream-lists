import { Popover } from '@mantine/core';
import { IconBolt, IconStar, IconStarFilled } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const RATINGS = Array.from({ length: 10 }, (_, index) => index + 1);

/** Pointauc bid on the title; 0 for a lot nobody bid on, nothing for a title that is not from an auction. */
export const Points = ({ value }: { value: number | null }) => {
  const { i18n } = useTranslation();
  if (value === null) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-px text-xs font-extrabold text-[var(--primary-hi)] tabular-nums">
      <IconBolt size={12} />
      {value.toLocaleString(i18n.language)}
    </span>
  );
};

interface RatingBadgeProps {
  rating: number | null;
  /** Only the streamer passes it: the badge becomes a button with 1–10. Clicking the current rating clears it. */
  onChange?: (rating: number | null) => void;
}

/** The streamer's 1–10 rating of a watched title. */
export const RatingBadge = ({ rating, onChange }: RatingBadgeProps) => {
  const { t } = useTranslation();
  const [isOpened, setIsOpened] = useState(false);

  const badge = rating ? (
    <span className="inline-flex shrink-0 items-center gap-px text-xs font-extrabold text-gold tabular-nums">
      <IconStarFilled size={12} />
      {rating}
    </span>
  ) : null;
  if (!onChange) return badge;

  return (
    <Popover opened={isOpened} onChange={setIsOpened} position="bottom-end" width={190}>
      <Popover.Target>
        <button
          type="button"
          aria-label={t('rating.set')}
          title={t('rating.set')}
          className="inline-flex shrink-0 items-center rounded-md px-1 py-0.5 hover:bg-white/10"
          onClick={() => setIsOpened((opened) => !opened)}
        >
          {badge ?? <IconStar size={14} className="text-fg-3" />}
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <div className="grid grid-cols-5 gap-1">
          {RATINGS.map((value) => (
            <button
              key={value}
              type="button"
              className={`rounded-lg py-1.5 text-sm font-extrabold hover:bg-white/10 ${value === rating ? 'selected text-gold' : ''}`}
              onClick={() => {
                onChange(value === rating ? null : value);
                setIsOpened(false);
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
};
