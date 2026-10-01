import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Button, ScrollArea } from '@mantine/core';
import { IconCheck, IconGripVertical, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import type { ListKind } from '@domains/lists/model/useChannel';
import { HIDE_ON_HOVER, SHOW_ON_HOVER } from '@domains/lists/ui/hoverActions';
import ConfirmPopover from '@shared/ui/ConfirmPopover';
import Poster from '@shared/ui/Poster';

interface QueueColumnProps {
  kind: ListKind;
  items: ItemRow[];
  onWatched: (itemId: number) => void;
  onDelete: (itemId: number) => void;
  onReorder: (ids: number[]) => void;
}

interface QueueRowProps extends Omit<QueueColumnProps, 'items' | 'onReorder'> {
  item: ItemRow;
  index: number;
}

const QueueRow = ({ item, index, kind, onWatched, onDelete }: QueueRowProps) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative flex h-11 items-center gap-2.5 rounded-xl px-2 text-[13px] font-bold hover:selected ${
        isDragging ? 'selected z-10' : ''
      }`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="cursor-grab touch-none text-fg-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        {...attributes}
        {...listeners}
      >
        <IconGripVertical size={14} />
      </button>
      <span className="w-4 shrink-0 text-right text-[11px] text-fg-3 tabular-nums">{index + 1}</span>
      <Poster path={item.poster_path} width={22} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.year && <span className={`text-xs text-fg-3 tabular-nums ${HIDE_ON_HOVER}`}>{item.year}</span>}
      <span className={`items-center gap-1 ${SHOW_ON_HOVER}`}>
        <Button size="compact-xs" leftSection={<IconCheck size={13} />} onClick={() => onWatched(item.id)}>
          {t(`columns.${kind}.markWatched`)}
        </Button>
        <ConfirmPopover
          message={t('config.deleteItem', { title: item.title })}
          confirmLabel={t('config.delete')}
          onConfirm={() => onDelete(item.id)}
        >
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('config.delete')}>
            <IconTrash size={14} />
          </ActionIcon>
        </ConfirmPopover>
      </span>
    </div>
  );
};

const QueueColumn = ({ items, onReorder, ...rowProps }: QueueColumnProps) => {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = items.map((item) => item.id);
    onReorder(arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id))));
  };

  return (
    <section className="glass flex min-h-0 flex-col overflow-hidden rounded-[22px]">
      <div className="flex h-[50px] shrink-0 items-center gap-2 px-4 pt-1.5">
        <span className="label">{t('columns.queue')}</span>
        <span className="text-xs text-fg-3">{items.length}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1" px={8} pb={8}>
        {items.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              {items.map((item, index) => (
                <QueueRow key={item.id} item={item} index={index} {...rowProps} />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <p className="px-2 py-6 text-center text-sm text-fg-3">{t('config.emptyQueue')}</p>
        )}
      </ScrollArea>
    </section>
  );
};

export default QueueColumn;
