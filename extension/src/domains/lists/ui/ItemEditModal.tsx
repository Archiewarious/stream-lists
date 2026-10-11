import { Button, Modal } from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import type { EditableItemFields, ListKind } from '@domains/lists/model/useChannel';
import { RatingBadge } from '@domains/lists/ui/ItemMeta';
import MovieSearchInput from '@domains/movies/ui/MovieSearchInput';
import Poster from '@shared/ui/Poster';

interface ItemEditModalProps {
  item: ItemRow | null;
  kind: ListKind;
  onClose: () => void;
  onSave: (itemId: number, fields: EditableItemFields) => void;
  /** Full screen: the panel on the channel page is only 318 px wide. */
  isFullScreen?: boolean;
}

/** Fix a title that came without a poster (or with a wrong one): type the name, pick the right suggestion. */
const ItemEditModal = ({ item, kind, onClose, onSave, isFullScreen }: ItemEditModalProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (item) setTitle(item.title);
  }, [item]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (item && nextTitle && nextTitle !== item.title) onSave(item.id, { title: nextTitle });
    onClose();
  };

  return (
    <Modal
      opened={!!item}
      onClose={onClose}
      fullScreen={isFullScreen}
      centered
      title={<span className="script text-4xl">{t('edit.title')}</span>}
    >
      {item && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Poster path={item.poster_path} width={44} />
            <p className="min-w-0 flex-1 text-sm text-fg-2">
              {item.poster_path ? t('edit.hasPoster') : t('edit.noPoster')}
            </p>
          </div>

          <MovieSearchInput
            withSuggestions={kind === 'movies'}
            placeholder={t('edit.placeholder')}
            value={title}
            onChange={setTitle}
            plainLabelKey="edit.keepTitle"
            onPick={(pickedTitle, movie) => {
              onSave(item.id, { title: pickedTitle, ...movie });
              onClose();
            }}
          />

          {item.status === 'watched' && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">{t('rating.label')}</span>
              <RatingBadge rating={item.rating} onChange={(rating) => onSave(item.id, { rating })} />
            </div>
          )}

          <Button type="submit">{t('edit.save')}</Button>
        </form>
      )}
    </Modal>
  );
};

export default ItemEditModal;
