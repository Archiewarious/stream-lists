import { Button, Group, Modal, Text, Textarea } from '@mantine/core';
import { IconCheck, IconList, IconPlus } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_BULK_ITEMS, parseBulkTitles } from '@domains/lists/lib/items';
import type { ItemStatus, ListKind, MovieFields } from '@domains/lists/model/useChannel';
import MovieSearchInput from '@domains/movies/ui/MovieSearchInput';

interface AddItemBarProps {
  kind: ListKind;
  /** Returns a message when the title was not added (already in the list). */
  onAdd: (title: string, movie?: MovieFields) => string | null;
  /** "Paste a list" — only offered when given. Resolves false when saving failed: the pasted text stays. */
  onBulk?: (titles: string[], status: ItemStatus) => Promise<boolean>;
  /** Narrow panel: shorter hint and a smaller field. */
  isCompact?: boolean;
  /** Where a single title goes — the open tab; only changes the hint in the field. */
  target?: 'queue' | 'watched';
}

/** One title → the open tab; with `onBulk`, "Списком" pastes many at once (to the queue or straight to watched). */
const AddItemBar = ({ kind, onAdd, onBulk, isCompact, target = 'queue' }: AddItemBarProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isBulkOpened, setIsBulkOpened] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const bulkTitles = parseBulkTitles(bulkText);
  const isTooMany = bulkTitles.length > MAX_BULK_ITEMS;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    add(title.trim());
  };

  const add = (nextTitle: string, movie?: MovieFields) => {
    const error = onAdd(nextTitle, movie);
    setAddError(error);
    if (!error) setTitle('');
  };

  const submitBulk = async (status: ItemStatus) => {
    if (!onBulk) return;
    setIsBulkSaving(true);
    const isSaved = await onBulk(bulkTitles, status);
    setIsBulkSaving(false);
    if (!isSaved) return;
    setIsBulkOpened(false);
    setBulkText('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-2.5">
      <MovieSearchInput
        withSuggestions={kind === 'movies'}
        size={isCompact ? 'sm' : 'md'}
        placeholder={t(
          isCompact
            ? target === 'watched'
              ? 'config.addShortWatched'
              : 'config.addShort'
            : kind === 'movies'
              ? 'movies.searchPlaceholder'
              : 'config.addPlaceholder',
        )}
        value={title}
        onChange={(value) => {
          setTitle(value);
          setAddError(null);
        }}
        onPick={add}
        error={addError}
      />

      {onBulk && (
        <>
          <Button variant="default" size="md" leftSection={<IconList size={18} />} onClick={() => setIsBulkOpened(true)}>
            {t('config.bulk')}
          </Button>

          <Modal
            opened={isBulkOpened}
            onClose={() => setIsBulkOpened(false)}
            title={<span className="script text-4xl">{t('config.bulkTitle')}</span>}
            size="lg"
            centered
          >
            <Text size="sm" c="dimmed" mb="sm">
              {t('config.bulkHint')}
            </Text>
            <Textarea
              autosize
              minRows={8}
              maxRows={14}
              value={bulkText}
              onChange={(event) => setBulkText(event.currentTarget.value)}
              placeholder={'Матрица\nТроя\nЧужой'}
              error={isTooMany && t('config.bulkTooMany', { max: MAX_BULK_ITEMS })}
              classNames={{ input: '!rounded-[18px]' }}
              data-autofocus
            />
            <Group justify="flex-end" mt="md">
              <Button
                variant="default"
                leftSection={<IconCheck size={16} />}
                disabled={!bulkTitles.length || isTooMany}
                loading={isBulkSaving}
                onClick={() => submitBulk('watched')}
              >
                {t(`columns.${kind}.toWatched`)}
              </Button>
              <Button
                leftSection={<IconPlus size={16} />}
                disabled={!bulkTitles.length || isTooMany}
                loading={isBulkSaving}
                onClick={() => submitBulk('queue')}
              >
                {t('config.bulkToQueue', { count: bulkTitles.length })}
              </Button>
            </Group>
          </Modal>
        </>
      )}
    </form>
  );
};

export default AddItemBar;
