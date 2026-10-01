import { Button, Group, Popover, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addItem,
  changeListKind,
  getItemsByStatus,
  ITEM_STATUSES,
  LIST_KINDS,
  MAX_ITEM_TITLE_LENGTH,
  MAX_LIST_TITLE_LENGTH,
  removeItem,
  removeList,
  renameList,
  setItemStatus,
} from '@domains/lists/lib/channelLists';
import type { ChannelListsChange, ListKind, StreamList } from '@domains/lists/model/types';
import EditableItemRow from '@domains/lists/ui/EditableItemRow';
import SectionTitle from '@domains/lists/ui/SectionTitle';

interface ListEditorProps {
  list: StreamList;
  /** Returns false when the change was rejected (Twitch storage limit). */
  onChange: (change: ChannelListsChange) => boolean;
}

const ListEditor = ({ list, onChange }: ListEditorProps) => {
  const { t } = useTranslation();
  const [newItemTitle, setNewItemTitle] = useState('');
  const [isDeleteConfirmOpened, setIsDeleteConfirmOpened] = useState(false);

  const handleRename = (input: HTMLInputElement) => {
    const title = input.value.trim();
    if (title === list.title) return;
    if (!title || !onChange((data) => renameList(data, list.id, title))) input.value = list.title;
  };

  const handleAddItem = (event: FormEvent) => {
    event.preventDefault();
    const title = newItemTitle.trim();
    if (title && onChange((data) => addItem(data, list.id, title))) setNewItemTitle('');
  };

  const handleDelete = () => {
    setIsDeleteConfirmOpened(false);
    onChange((data) => removeList(data, list.id));
  };

  return (
    <Stack gap="md" p="md">
      <Group gap="sm" align="flex-end" wrap="nowrap">
        <TextInput
          label={t('config.listTitle')}
          defaultValue={list.title}
          maxLength={MAX_LIST_TITLE_LENGTH}
          className="min-w-0 flex-1"
          onBlur={(event) => handleRename(event.currentTarget)}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
        <SegmentedControl
          value={list.kind}
          onChange={(kind) => onChange((data) => changeListKind(data, list.id, kind as ListKind))}
          data={LIST_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))}
        />
      </Group>

      <form onSubmit={handleAddItem}>
        <Group gap="sm" wrap="nowrap">
          <TextInput
            placeholder={t('config.addItemPlaceholder')}
            value={newItemTitle}
            maxLength={MAX_ITEM_TITLE_LENGTH}
            className="min-w-0 flex-1"
            onChange={(event) => setNewItemTitle(event.currentTarget.value)}
          />
          <Button type="submit" leftSection={<IconPlus size={16} />}>
            {t('config.add')}
          </Button>
        </Group>
      </form>

      {list.items.length === 0 && (
        <Text size="sm" c="dimmed">
          {t('config.emptyList')}
        </Text>
      )}

      {ITEM_STATUSES.map((status) => {
        const items = getItemsByStatus(list, status);
        if (!items.length) return null;

        return (
          <Stack key={status} gap={4}>
            <SectionTitle label={t(`status.${list.kind}.${status}`)} count={items.length} isAccent={status === 'now'} />
            {items.map((item) => (
              <EditableItemRow
                key={item.id}
                item={item}
                kind={list.kind}
                onStatusChange={(nextStatus) => onChange((data) => setItemStatus(data, list.id, item.id, nextStatus))}
                onRemove={() => onChange((data) => removeItem(data, list.id, item.id))}
              />
            ))}
          </Stack>
        );
      })}

      <Group justify="flex-end">
        <Popover opened={isDeleteConfirmOpened} onChange={setIsDeleteConfirmOpened} position="top-end" withArrow>
          <Popover.Target>
            <Button
              variant="subtle"
              color="red"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={() => setIsDeleteConfirmOpened((isOpened) => !isOpened)}
            >
              {t('config.deleteList')}
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm" mb="sm">
              {t('config.deleteListConfirm', { title: list.title })}
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button size="xs" variant="default" onClick={() => setIsDeleteConfirmOpened(false)}>
                {t('config.cancel')}
              </Button>
              <Button size="xs" color="red" onClick={handleDelete}>
                {t('config.delete')}
              </Button>
            </Group>
          </Popover.Dropdown>
        </Popover>
      </Group>
    </Stack>
  );
};

export default ListEditor;
