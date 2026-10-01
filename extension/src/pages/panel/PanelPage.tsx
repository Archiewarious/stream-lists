import { Center, Loader, Tabs, Text } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChannelLists } from '@domains/lists/model/useChannelLists';
import KindIcon from '@domains/lists/ui/KindIcon';
import ListView from '@domains/lists/ui/ListView';

const PanelPage = () => {
  const { t } = useTranslation();
  const { channelLists, isLoaded } = useChannelLists({ isEditor: false });
  const [activeListId, setActiveListId] = useState<string | null>(null);

  if (!isLoaded) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  const { lists } = channelLists;
  if (!lists.length) {
    return (
      <Center h="100%" p="md">
        <Text size="sm" c="dimmed" ta="center">
          {t('panel.empty')}
        </Text>
      </Center>
    );
  }

  const activeList = lists.find((list) => list.id === activeListId) ?? lists[0];

  return (
    <div className="flex h-full flex-col">
      {lists.length > 1 && (
        <Tabs value={activeList.id} onChange={setActiveListId}>
          <Tabs.List>
            {lists.map((list) => (
              <Tabs.Tab key={list.id} value={list.id} leftSection={<KindIcon kind={list.kind} size={14} />}>
                {list.title}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      )}
      <div className="min-h-0 flex-1">
        <ListView list={activeList} />
      </div>
    </div>
  );
};

export default PanelPage;
