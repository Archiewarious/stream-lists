import { ActionIcon, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconArrowBackUp, IconCheck, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import type { ItemStatus, ListItem, ListKind } from '@domains/lists/model/types';

const STATUS_ACTIONS: Record<ItemStatus, { status: ItemStatus; Icon: typeof IconCheck }[]> = {
  queue: [
    { status: 'now', Icon: IconPlayerPlay },
    { status: 'done', Icon: IconCheck },
  ],
  now: [
    { status: 'done', Icon: IconCheck },
    { status: 'queue', Icon: IconArrowBackUp },
  ],
  done: [{ status: 'queue', Icon: IconArrowBackUp }],
};

interface EditableItemRowProps {
  item: ListItem;
  kind: ListKind;
  onStatusChange: (status: ItemStatus) => void;
  onRemove: () => void;
}

const EditableItemRow = ({ item, kind, onStatusChange, onRemove }: EditableItemRowProps) => {
  const { t } = useTranslation();

  return (
    <Paper withBorder radius="sm" px="sm" py={4}>
      <Group gap={4} wrap="nowrap">
        <Text
          size="sm"
          fw={item.status === 'now' ? 600 : undefined}
          c={item.status === 'done' ? 'dimmed' : undefined}
          className="min-w-0 flex-1 break-words"
        >
          {item.title}
        </Text>
        {STATUS_ACTIONS[item.status].map(({ status, Icon }) => (
          <Tooltip key={status} label={t(`status.${kind}.${status}`)}>
            <ActionIcon
              variant="subtle"
              aria-label={t(`status.${kind}.${status}`)}
              onClick={() => onStatusChange(status)}
            >
              <Icon size={16} />
            </ActionIcon>
          </Tooltip>
        ))}
        <Tooltip label={t('config.remove')}>
          <ActionIcon variant="subtle" color="red" aria-label={t('config.remove')} onClick={onRemove}>
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
};

export default EditableItemRow;
