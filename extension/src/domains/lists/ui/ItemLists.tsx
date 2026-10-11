import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Button } from '@mantine/core';
import { IconArrowBackUp, IconCheck, IconGripVertical, IconPencil, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import { formatDay, groupByMonth } from '@domains/lists/lib/items';
import type { ListKind } from '@domains/lists/model/useChannel';
import { HIDE_ON_HOVER, SHOW_ON_HOVER } from '@domains/lists/ui/hoverActions';
import { Points, RatingBadge } from '@domains/lists/ui/ItemMeta';
import ConfirmPopover from '@shared/ui/ConfirmPopover';
import Poster from '@shared/ui/Poster';

/** What the streamer can do with a row. */
export interface ItemActions {
  onWatched: (itemId: number) => void;
  onRequeue: (itemId: number) => void;
  onDelete: (itemId: number) => void;
  onEdit: (item: ItemRow) => void;
  onRate: (itemId: number, rating: number | null) => void;
}

interface RowProps extends ItemActions {
  kind: ListKind;
  /** Narrow panel: the "watched" button is only an icon. */
  isCompact: boolean;
}

const DeleteButton = ({ item, onDelete }: { item: ItemRow; onDelete: ItemActions['onDelete'] }) => {
  const { t } = useTranslation();

  return (
    <ConfirmPopover
      message={t('config.deleteItem', { title: item.title })}
      confirmLabel={t('config.delete')}
      onConfirm={() => onDelete(item.id)}
    >
      <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('config.delete')}>
        <IconTrash size={14} />
      </ActionIcon>
    </ConfirmPopover>
  );
};

const EditButton = ({ item, onEdit }: { item: ItemRow; onEdit: ItemActions['onEdit'] }) => {
  const { t } = useTranslation();

  return (
    <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('edit.open')} onClick={() => onEdit(item)}>
      <IconPencil size={14} />
    </ActionIcon>
  );
};

const QueueRow = ({ item, index, kind, isCompact, ...actions }: RowProps & { item: ItemRow; index: number }) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative flex min-h-[50px] items-center gap-2 py-1 rounded-xl px-1.5 text-[13px] font-bold hover:selected ${
        isDragging ? 'selected z-10' : ''
      }`}
    >
      {item.points === null ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="cursor-grab touch-none text-fg-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" /> // a title with a bid has its place by the bid
      )}
      <span className="w-4 shrink-0 text-right text-[11px] text-fg-3 tabular-nums">{index + 1}</span>
      <Poster path={item.poster_path} width={24} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 leading-tight">{item.title}</span>
        <span className="min-h-[12px] text-[11px] font-semibold text-fg-3 tabular-nums">{item.year}</span>
      </span>
      <span className={`flex items-center ${HIDE_ON_HOVER}`}>
        <Points value={item.points} />
      </span>
      <span className={`items-center gap-0.5 ${SHOW_ON_HOVER}`}>
        {isCompact ? (
          <ActionIcon size="sm" aria-label={t(`columns.${kind}.markWatched`)} onClick={() => actions.onWatched(item.id)}>
            <IconCheck size={14} />
          </ActionIcon>
        ) : (
          <Button size="compact-xs" leftSection={<IconCheck size={13} />} onClick={() => actions.onWatched(item.id)}>
            {t(`columns.${kind}.markWatched`)}
          </Button>
        )}
        <EditButton item={item} onEdit={actions.onEdit} />
        <DeleteButton item={item} onDelete={actions.onDelete} />
      </span>
    </div>
  );
};

interface QueueListProps extends ItemActions {
  kind: ListKind;
  items: ItemRow[];
  isCompact?: boolean;
  emptyText: string;
  onReorder: (ids: number[]) => void;
}

/** The queue with drag & drop and the streamer's actions on every row. */
export const QueueList = ({ items, onReorder, emptyText, isCompact = false, ...rowProps }: QueueListProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = items.map((item) => item.id);
    onReorder(arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id))));
  };

  if (!items.length) return <p className="px-2 py-6 text-center text-sm text-fg-3">{emptyText}</p>;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        {items.map((item, index) => (
          <QueueRow key={item.id} item={item} index={index} isCompact={isCompact} {...rowProps} />
        ))}
      </SortableContext>
    </DndContext>
  );
};

interface WatchedListProps extends ItemActions {
  /** Newest first. */
  items: ItemRow[];
  isCompact?: boolean;
  emptyText: string;
}

/** Watched titles by month, with the rating and the streamer's actions. */
export const WatchedList = ({ items, emptyText, isCompact = false, ...actions }: WatchedListProps) => {
  const { t, i18n } = useTranslation();
  if (!items.length) return <p className="px-2 py-6 text-center text-sm text-fg-3">{emptyText}</p>;

  return groupByMonth(items, i18n.language).map((month) => (
    <div key={month.key}>
      <div className="flex justify-between px-2 pt-2.5 pb-1">
        <span className="label">{month.title}</span>
        <span className="label">{month.items.length}</span>
      </div>
      {month.items.map((item) => (
        <div key={item.id} className="group flex min-h-[50px] items-center gap-2 rounded-xl px-1.5 py-1 text-[13px] font-bold hover:selected">
          <span className="opacity-70">
            <Poster path={item.poster_path} width={24} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="line-clamp-2 leading-tight">{item.title}</span>
            <span className="min-h-[12px] text-[11px] font-semibold text-fg-3 tabular-nums">{item.year}</span>
          </span>
          <span className={`text-xs font-semibold text-fg-3 ${HIDE_ON_HOVER}`}>
            {item.watched_at && formatDay(item.watched_at, i18n.language)}
          </span>
          <RatingBadge rating={item.rating} onChange={(rating) => actions.onRate(item.id, rating)} />
          <span className={`items-center gap-0.5 ${SHOW_ON_HOVER}`}>
            {isCompact ? (
              <ActionIcon
                variant="default"
                size="sm"
                aria-label={t('config.requeue')}
                title={t('config.requeue')}
                onClick={() => actions.onRequeue(item.id)}
              >
                <IconArrowBackUp size={14} />
              </ActionIcon>
            ) : (
              <Button
                variant="default"
                size="compact-xs"
                leftSection={<IconArrowBackUp size={13} />}
                onClick={() => actions.onRequeue(item.id)}
              >
                {t('config.requeue')}
              </Button>
            )}
            <EditButton item={item} onEdit={actions.onEdit} />
            <DeleteButton item={item} onDelete={actions.onDelete} />
          </span>
        </div>
      ))}
    </div>
  ));
};
