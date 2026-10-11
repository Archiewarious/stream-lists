import { Combobox, TextInput, useCombobox } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TmdbResult } from '@worker/tmdb';
import type { MovieFields } from '@domains/lists/model/useChannel';
import { callWorker } from '@shared/api/workerApi';
import Poster from '@shared/ui/Poster';

const MIN_QUERY_LENGTH = 2;
const PLAIN = 'plain';

interface MovieSearchInputProps {
  /** Off for games and custom lists: a plain input. */
  withSuggestions: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (title: string, movie?: MovieFields) => void;
  error?: string | null;
  /** Text of the last option, which keeps the typed title without a poster. */
  plainLabelKey?: string;
  autoFocus?: boolean;
  size?: 'sm' | 'md';
}

/**
 * Title input with TMDB suggestions: picking one saves the poster and year. Enter takes the highlighted
 * suggestion; with none highlighted the surrounding form submits the plain title.
 */
const MovieSearchInput = ({
  withSuggestions,
  placeholder,
  value,
  onChange,
  onPick,
  error,
  plainLabelKey = 'movies.withoutPoster',
  autoFocus,
  size = 'md',
}: MovieSearchInputProps) => {
  const { t, i18n } = useTranslation();
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const [debouncedValue] = useDebouncedValue(value.trim(), 300);
  const [results, setResults] = useState<TmdbResult[]>([]);

  useEffect(() => {
    if (!withSuggestions || debouncedValue.length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let isCancelled = false;
    const params = new URLSearchParams({ q: debouncedValue, lang: i18n.language });
    callWorker<TmdbResult[]>('GET', `/api/tmdb/search?${params}`)
      .then((nextResults) => !isCancelled && setResults(nextResults))
      .catch(() => !isCancelled && setResults([])); // no key or TMDB down: adding still works without posters
    return () => {
      isCancelled = true;
    };
  }, [debouncedValue, withSuggestions, i18n.language]);

  useEffect(() => {
    if (results.length) combobox.selectFirstOption();
  }, [results]); // combobox is a new object every render

  const pick = (optionValue: string) => {
    const result = results[Number(optionValue)];
    if (result) onPick(result.title, {
        tmdb_id: result.tmdb_id,
        year: result.year,
        poster_path: result.poster_path,
        tmdb_type: result.type,
      });
    else onPick(value.trim());
    setResults([]);
    combobox.closeDropdown();
  };

  const isOpen = withSuggestions && value.trim().length >= MIN_QUERY_LENGTH;

  return (
    <Combobox store={combobox} onOptionSubmit={pick} offset={10}>
      <Combobox.Target>
        <TextInput
          className="flex-1"
          size={size}
          leftSection={withSuggestions ? <IconSearch size={18} /> : <IconPlus size={18} />}
          placeholder={placeholder}
          maxLength={200}
          autoFocus={autoFocus}
          error={error}
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            combobox.openDropdown();
          }}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
        />
      </Combobox.Target>

      <Combobox.Dropdown hidden={!isOpen}>
        <Combobox.Options>
          {results.map((result, index) => (
            <Combobox.Option key={result.tmdb_id} value={String(index)} className="flex items-center gap-3">
              <Poster path={result.poster_path} width={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{result.title}</span>
                <span className="text-xs text-fg-3">
                  {[result.year, t(`movies.${result.type}`)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </Combobox.Option>
          ))}
          <Combobox.Option value={PLAIN} className="flex items-center gap-3 text-fg-2">
            <span className="flex w-[34px] justify-center text-fg-3">
              <IconPlus size={18} />
            </span>
            {t(plainLabelKey, { title: value.trim() })}
          </Combobox.Option>
        </Combobox.Options>
        <Combobox.Footer className="!border-0 !px-2.5 !pt-1 !pb-0.5 text-[11px] text-fg-3">{t('movies.tmdb')}</Combobox.Footer>
      </Combobox.Dropdown>
    </Combobox>
  );
};

export default MovieSearchInput;
