import { Button, Group, Modal, Text, Textarea } from '@mantine/core';
import { IconCheck, IconList, IconPlus } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_BULK_ITEMS, parseBulkTitles } from '@domains/lists/lib/items';
import type { ItemStatus, ListKind, MovieFields } from '@domains/lists/model/useChannel';
import MovieSearchInput from '@domains/movies/ui/MovieSearchInput';

interface AddItemBarProps {
  kind: ListKind;
  onAdd: (title: string, movie?: MovieFields) => void;
  onBulk: (titles: string[], status: ItemStatus) => Promise<void>;
}

/** One title → queue; "Списком" pastes many at once (to the queue or straight to watched). */
const AddItemBar = ({ kind, onAdd, onBulk }: AddItemBarProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [isBulkOpened, setIsBulkOpened] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const bulkTitles = parseBulkTitles(bulkText);
  const isTooMany = bulkTitles.length > MAX_BULK_ITEMS;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd(title.trim());
    setTitle('');
  };

  const submitBulk = async (status: ItemStatus) => {
    setIsBulkSaving(true);
    await onBulk(bulkTitles, status);
    setIsBulkSaving(false);
    setIsBulkOpened(false);
    setBulkText('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2.5">
      <MovieSearchInput
        withSuggestions={kind === 'movies'}
        placeholder={t(kind === 'movies' ? 'movies.searchPlaceholder' : 'config.addPlaceholder')}
        value={title}
        onChange={setTitle}
        onPick={(pickedTitle, movie) => {
          onAdd(pickedTitle, movie);
          setTitle('');
        }}
      />
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
    </form>
  );
};

export default AddItemBar;
