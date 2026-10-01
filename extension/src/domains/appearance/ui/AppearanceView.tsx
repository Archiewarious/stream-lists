import { Title } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';

import type { ChannelList } from '@worker/snapshot';
import type { ChannelTheme } from '@worker/theme';
import { DEFAULT_THEME, PRESETS, type PresetId } from '@app/presets';
import { formatDay } from '@domains/lists/lib/items';
import Poster from '@shared/ui/Poster';

const DEFAULT_CUSTOM = { primary: '#c650f4', accent: '#ff7ac1' };
const SAVE_DELAY_MS = 600;

interface AppearanceViewProps {
  theme: ChannelTheme | null;
  /** The list shown in the preview. */
  list: ChannelList | undefined;
  onPreview: (theme: ChannelTheme) => void;
  onSave: (theme: ChannelTheme) => void;
}

const SELECTED = { boxShadow: 'var(--glass-shine), var(--ring)' };
const ORB_SHADOW = 'inset 0 2px 3px rgb(255 255 255 / 0.55), inset 0 -4px 8px rgb(0 0 0 / 0.25), 0 4px 14px rgb(0 0 0 / 0.35)';

/** "Оформление": presets and own colors; the whole window repaints at once, viewers get it with the next snapshot. */
const AppearanceView = ({ theme, list, onPreview, onSave }: AppearanceViewProps) => {
  const { t, i18n } = useTranslation();
  const current = theme ?? DEFAULT_THEME;
  const custom = 'preset' in current ? DEFAULT_CUSTOM : current;
  // A color picker fires on every drag step: repaint each time, save once it settles.
  const saveLater = useDebouncedCallback(onSave, SAVE_DELAY_MS);

  const pick = (nextTheme: ChannelTheme) => {
    onPreview(nextTheme);
    onSave(nextTheme);
  };

  const pickColor = (key: 'primary' | 'accent', color: string) => {
    const nextTheme = { ...custom, [key]: color };
    onPreview(nextTheme);
    saveLater(nextTheme);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-6 overflow-y-auto px-1 pt-1">
      <div>
        <Title order={1} size={48} className="!leading-[1.25]">
          {t('appearance.title')}
        </Title>
        <p className="mt-1 mb-4 text-sm text-fg-2">{t('appearance.subtitle')}</p>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => pick({ preset: id })}
              className="glass flex items-center gap-3 rounded-[18px] p-3 text-left text-sm font-bold"
              style={'preset' in current && current.preset === id ? SELECTED : undefined}
              aria-pressed={'preset' in current && current.preset === id}
            >
              <span
                className="size-[34px] shrink-0 rounded-full"
                style={{ background: `linear-gradient(180deg, ${PRESETS[id].primaryHi}, ${PRESETS[id].primaryLo})`, boxShadow: ORB_SHADOW }}
              />
              <span className="min-w-0">
                {t(`appearance.presets.${id}.name`)}
                <small className="block text-[11px] font-semibold text-fg-3">{t(`appearance.presets.${id}.hint`)}</small>
              </span>
            </button>
          ))}
        </div>

        <div
          className="glass mt-3.5 flex flex-wrap items-center gap-3 rounded-[18px] p-3.5 text-sm font-bold"
          style={'preset' in current ? undefined : SELECTED}
        >
          <button type="button" className="flex-1 text-left" onClick={() => pick(custom)}>
            {t('appearance.custom')}
          </button>
          {(['primary', 'accent'] as const).map((key) => (
            <label key={key} className="glass-soft flex cursor-pointer items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 text-xs text-fg-2">
              <span className="relative size-6 overflow-hidden rounded-full" style={{ background: custom[key], boxShadow: ORB_SHADOW }}>
                <input
                  type="color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={custom[key]}
                  onChange={(event) => pickColor(key, event.currentTarget.value)}
                />
              </span>
              {t(`appearance.${key}`)}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="label mb-2">{t('appearance.preview')}</div>
        <div className="glass flex h-[300px] flex-col gap-2 overflow-hidden rounded-[18px] p-2.5">
          <div className="script truncate pl-0.5 text-[30px] leading-[1.2]">{list?.title ?? t('kindsShort.movies')}</div>
          <div className="glass-soft grid grid-cols-2 rounded-full p-[3px] text-center text-xs font-bold text-fg-2">
            <span className="selected rounded-full py-1.5 text-fg">{t('columns.queue')}</span>
            <span className="py-1.5">{t(`columns.${list?.kind ?? 'movies'}.watched`)}</span>
          </div>
          <div className="glass-soft min-h-0 flex-1 rounded-[18px] p-1.5">
            {list?.items
              .filter((item) => item.status === 'queue')
              .slice(0, 4)
              .map((item, index) => (
                <div key={item.id} className="flex h-[46px] items-center gap-2.5 px-1.5 text-[13px] font-bold">
                  <span className="w-3.5 text-right text-[11px] text-fg-3">{index + 1}</span>
                  <Poster path={item.poster_path} width={24} />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.year && <span className="text-xs text-fg-3">{item.year}</span>}
                </div>
              ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip chip-seen">{t('columns.movies.seenChip', { date: formatDay(Date.now(), i18n.language) })}</span>
          <span className="chip chip-queue">{t('panel.inQueue', { position: 7 })}</span>
          <span className="chip chip-new">{t('appearance.newChip')}</span>
        </div>
      </div>
    </div>
  );
};

export default AppearanceView;
