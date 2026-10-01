import { Center, Group, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import { getItemsByStatus } from '@domains/lists/lib/channelLists';
import type { StreamList } from '@domains/lists/model/types';
import SectionTitle from '@domains/lists/ui/SectionTitle';

interface ListViewProps {
  list: StreamList;
}

/** Read-only list for viewers: "now" highlighted, numbered queue, dimmed done. */
const ListView = ({ list }: ListViewProps) => {
  const { t } = useTranslation();

  if (!list.items.length) {
    return (
      <Center h="100%" p="md">
        <Text size="sm" c="dimmed" ta="center">
          {t('panel.emptyList')}
        </Text>
      </Center>
    );
  }

  const nowItems = getItemsByStatus(list, 'now');
  const queueItems = getItemsByStatus(list, 'queue');
  const doneItems = getItemsByStatus(list, 'done');

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Stack gap="md" p="sm">
        {nowItems.length > 0 && (
          <Stack gap={6}>
            <SectionTitle label={t(`status.${list.kind}.now`)} isAccent />
            {nowItems.map((item) => (
              <Paper
                key={item.id}
                radius="sm"
                px="sm"
                py={8}
                bg="var(--mantine-primary-color-light)"
                style={{ borderLeft: '3px solid var(--mantine-primary-color-filled)' }}
              >
                <Text size="sm" fw={600} className="break-words">
                  {item.title}
                </Text>
              </Paper>
            ))}
          </Stack>
        )}

        {queueItems.length > 0 && (
          <Stack gap={4}>
            <SectionTitle label={t(`status.${list.kind}.queue`)} count={queueItems.length} />
            {queueItems.map((item, index) => (
              <Group key={item.id} gap="xs" wrap="nowrap" align="flex-start">
                <Text size="sm" c="dimmed" w={20} ta="right" className="shrink-0 tabular-nums">
                  {index + 1}
                </Text>
                <Text size="sm" className="min-w-0 break-words">
                  {item.title}
                </Text>
              </Group>
            ))}
          </Stack>
        )}

        {doneItems.length > 0 && (
          <Stack gap={4}>
            <SectionTitle label={t(`status.${list.kind}.done`)} count={doneItems.length} />
            {doneItems.map((item) => (
              <Group key={item.id} gap="xs" wrap="nowrap" align="flex-start">
                <IconCheck size={16} className="mt-0.5 shrink-0 opacity-60" />
                <Text size="sm" c="dimmed" className="min-w-0 break-words">
                  {item.title}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </ScrollArea>
  );
};

export default ListView;
