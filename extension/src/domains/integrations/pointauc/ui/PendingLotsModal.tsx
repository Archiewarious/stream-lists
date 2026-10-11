import { Button, Modal } from '@mantine/core';
import { IconCheck, IconEyeOff, IconPencil } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditableItemFields, PendingLot } from '@domains/lists/model/useChannel';
import { Points } from '@domains/lists/ui/ItemMeta';
import MovieSearchInput from '@domains/movies/ui/MovieSearchInput';

interface PendingLotsModalProps {
  opened: boolean;
  onClose: () => void;
  lots: PendingLot[];
  withSuggestions: boolean;
  onAccept: (lotId: number, fields?: EditableItemFields) => void;
  onDismiss: (lotId: number) => void;
  isFullScreen?: boolean;
}

/** Lots the sync could not verify: put them into the queue (maybe with a fixed title) or hide them. */
const PendingLotsModal = ({ opened, onClose, lots, withSuggestions, onAccept, onDismiss, isFullScreen }: PendingLotsModalProps) => {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');

  const startEdit = (lot: PendingLot) => {
    setEditingId(lot.id);
    setTitle(lot.name);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen={isFullScreen}
      centered
      size={560}
      title={<span className="script text-4xl">{t('pending.title')}</span>}
    >
      <p className="mb-3 text-sm text-fg-2">{t('pending.hint')}</p>
      {!lots.length && <p className="py-6 text-center text-sm text-fg-3">{t('pending.empty')}</p>}

      <div className="flex flex-col gap-2">
        {lots.map((lot) =>
          editingId === lot.id ? (
            <form
              key={lot.id}
              className="flex flex-col gap-2 rounded-[14px] bg-white/5 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                onAccept(lot.id, { title: title.trim() || lot.name });
                setEditingId(null);
              }}
            >
              <MovieSearchInput
                withSuggestions={withSuggestions}
                size="sm"
                autoFocus
                placeholder={t('edit.placeholder')}
                value={title}
                onChange={setTitle}
                plainLabelKey="edit.keepTitle"
                onPick={(pickedTitle, movie) => {
                  onAccept(lot.id, { title: pickedTitle, ...movie });
                  setEditingId(null);
                }}
              />
              <Button type="submit" size="compact-sm">
                {t('pending.add')}
              </Button>
            </form>
          ) : (
            <div key={lot.id} className="flex items-center gap-2 rounded-[14px] bg-white/5 px-3 py-2 text-sm font-bold">
              <span className="min-w-0 flex-1 truncate">{lot.name}</span>
              <Points value={lot.points} />
              <Button size="compact-xs" leftSection={<IconCheck size={13} />} onClick={() => onAccept(lot.id)}>
                {t('pending.add')}
              </Button>
              <Button variant="default" size="compact-xs" aria-label={t('pending.edit')} onClick={() => startEdit(lot)}>
                <IconPencil size={13} />
              </Button>
              <Button variant="default" size="compact-xs" aria-label={t('pending.hide')} onClick={() => onDismiss(lot.id)}>
                <IconEyeOff size={13} />
              </Button>
            </div>
          ),
        )}
      </div>
    </Modal>
  );
};

export default PendingLotsModal;
