import { Alert, Button, Center, Group, Loader, Paper, Popover, Progress, ScrollArea, Stack, Tabs, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addList,
  CONFIG_LIMIT_BYTES,
  createId,
  getByteSize,
  serializeChannelLists,
} from '@domains/lists/lib/channelLists';
import type { ChannelListsChange, ListKind } from '@domains/lists/model/types';
import { useChannelLists } from '@domains/lists/model/useChannelLists';
import KindIcon from '@domains/lists/ui/KindIcon';
import ListEditor from '@domains/lists/ui/ListEditor';
import NewListForm from '@domains/lists/ui/NewListForm';

const ConfigPage = () => {
  const { t } = useTranslation();
  const { channelLists, isLoaded, isCorrupted, applyChange } = useChannelLists({ isEditor: true });
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [isOverLimit, setIsOverLimit] = useState(false);
  const [isNewListOpened, setIsNewListOpened] = useState(false);

  const handleChange = (change: ChannelListsChange) => {
    const isApplied = applyChange(change);
    setIsOverLimit(!isApplied);
    return isApplied;
  };

  const handleCreateList = (title: string, kind: ListKind) => {
    const listId = createId();
    if (handleChange((data) => addList(data, listId, title, kind))) setActiveListId(listId);
    setIsNewListOpened(false);
  };

  if (!isLoaded) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  if (isCorrupted) {
    return (
      <Alert m="md" color="red" icon={<IconAlertTriangle />}>
        {t('config.corrupted')}
      </Alert>
    );
  }

  const { lists } = channelLists;
  if (!lists.length) {
    return (
      <Center h="100%" p="md">
        <Paper withBorder radius="md" p="lg" w={420} maw="100%">
          <Text fw={600} mb="md">
            {t('config.createFirst')}
          </Text>
          <NewListForm onCreate={handleCreateList} />
        </Paper>
      </Center>
    );
  }

  const activeList = lists.find((list) => list.id === activeListId) ?? lists[0];
  const usedBytes = getByteSize(serializeChannelLists(channelLists));

  return (
    <div className="flex h-full flex-col">
      <Group gap="sm" wrap="nowrap" align="flex-end" px="md" pt="sm">
        <Tabs value={activeList.id} onChange={setActiveListId} className="min-w-0 flex-1">
          <Tabs.List>
            {lists.map((list) => (
              <Tabs.Tab key={list.id} value={list.id} leftSection={<KindIcon kind={list.kind} />}>
                {list.title}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
        <Popover opened={isNewListOpened} onChange={setIsNewListOpened} position="bottom-end" width={360} withArrow shadow="md">
          <Popover.Target>
            <Button
              variant="light"
              size="xs"
              mb={6}
              leftSection={<IconPlus size={14} />}
              onClick={() => setIsNewListOpened((isOpened) => !isOpened)}
            >
              {t('config.newList')}
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <NewListForm onCreate={handleCreateList} />
          </Popover.Dropdown>
        </Popover>
      </Group>

      <ScrollArea className="min-h-0 flex-1">
        <ListEditor key={activeList.id} list={activeList} onChange={handleChange} />
      </ScrollArea>

      <Stack gap={6} px="md" py="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        {isOverLimit && (
          <Alert color="red" p="xs" icon={<IconAlertTriangle size={16} />}>
            {t('config.overLimit')}
          </Alert>
        )}
        <Group gap="sm" wrap="nowrap">
          <Text size="xs" c="dimmed" className="shrink-0">
            {t('config.storage', { used: (usedBytes / 1000).toFixed(1), total: CONFIG_LIMIT_BYTES / 1000 })}
          </Text>
          <Progress
            size="sm"
            className="flex-1"
            value={(usedBytes / CONFIG_LIMIT_BYTES) * 100}
            color={usedBytes > CONFIG_LIMIT_BYTES * 0.9 ? 'red' : undefined}
          />
        </Group>
      </Stack>
    </div>
  );
};

export default ConfigPage;
