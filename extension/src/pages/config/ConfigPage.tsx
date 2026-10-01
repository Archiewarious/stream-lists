import { ActionIcon, Button, Center, Loader, Modal, Text, Title } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChannel, type ItemStatus, type ListKind } from '@domains/lists/model/useChannel';
import AddItemBar from '@domains/lists/ui/AddItemBar';
import ListForm from '@domains/lists/ui/ListForm';
import ListsSidebar from '@domains/lists/ui/ListsSidebar';
import QueueColumn from '@domains/lists/ui/QueueColumn';
import WatchedColumn from '@domains/lists/ui/WatchedColumn';
import ConfirmPopover from '@shared/ui/ConfirmPopover';

const NOTICE_MS = 6000;

const ConfigPage = () => {
  const { t } = useTranslation();
  const channel = useChannel();
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [isSettingsOpened, setIsSettingsOpened] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const createList = async (title: string, kind: ListKind) => {
    const list = await channel.createList(title, kind);
    if (list) setActiveListId(list.id);
  };

  if (!channel.lists) {
    return (
      <Center h="100%">
        {channel.loadError ? (
          <div className="glass flex max-w-sm flex-col items-center gap-3 rounded-[22px] p-6 text-center">
            <Text fw={700}>{t('config.loadFailed', { error: channel.loadError })}</Text>
            <Button onClick={channel.reload}>{t('config.retry')}</Button>
          </div>
        ) : (
          <Loader color="var(--primary-hi)" />
        )}
      </Center>
    );
  }

  if (!channel.lists.length) {
    return (
      <Center h="100%" p="md">
        <div className="glass w-[360px] max-w-full rounded-[26px] p-6">
          <div className="script mb-1 text-[44px]">Stream Lists</div>
          <Text fw={700} c="dimmed" mb="md">
            {t('config.createFirst')}
          </Text>
          <ListForm submitLabel={t('config.create')} onSubmit={createList} />
        </div>
      </Center>
    );
  }

  const list = channel.lists.find((candidate) => candidate.id === activeListId) ?? channel.lists[0];
  const queue = list.items.filter((item) => item.status === 'queue');
  const watched = list.items.filter((item) => item.status === 'watched');

  const addBulk = async (titles: string[], status: ItemStatus) => {
    const result = await channel.addBulk(list.id, titles, status);
    if (!result) return;
    setNotice(t('config.bulkResult', { added: result.added.length, skipped: result.skipped }));
    setTimeout(() => setNotice(null), NOTICE_MS);
  };

  return (
    <div className="grid h-full grid-cols-[210px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3.5 p-3.5">
      <ListsSidebar
        lists={channel.lists}
        activeListId={list.id}
        onSelect={setActiveListId}
        onCreate={createList}
        isSaving={channel.isSaving}
        saveError={channel.saveError}
        onDismissError={channel.clearSaveError}
        notice={notice}
      />

      <main className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className="flex items-center gap-3 px-1 pt-1">
          <Title order={1} size={48} className="min-w-0 flex-1 truncate !leading-[1.25]">
            {list.title}
          </Title>
          <ActionIcon variant="default" size="lg" aria-label={t('config.listSettings')} onClick={() => setIsSettingsOpened(true)}>
            <IconDots size={18} />
          </ActionIcon>
        </div>

        <AddItemBar
          kind={list.kind}
          onAdd={(title) => channel.addItem(list.id, title, 'queue')}
          onBulk={addBulk}
        />

        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-3">
          <QueueColumn
            kind={list.kind}
            items={queue}
            onWatched={(itemId) => channel.setStatus(itemId, 'watched')}
            onDelete={channel.deleteItem}
            onReorder={(ids) => channel.reorderQueue(list.id, ids)}
          />
          <WatchedColumn
            kind={list.kind}
            items={watched}
            onRequeue={(itemId) => channel.setStatus(itemId, 'queue')}
            onDelete={channel.deleteItem}
          />
        </div>
      </main>

      <Modal
        opened={isSettingsOpened}
        onClose={() => setIsSettingsOpened(false)}
        title={<span className="script text-4xl">{t('config.listSettings')}</span>}
        centered
      >
        <ListForm
          key={list.id}
          initialTitle={list.title}
          initialKind={list.kind}
          submitLabel={t('config.save')}
          onSubmit={(title, kind) => {
            setIsSettingsOpened(false);
            channel.updateList(list.id, { title, kind });
          }}
        />
        <div className="mt-4 flex justify-center">
          <ConfirmPopover
            message={t('config.deleteListConfirm', { title: list.title })}
            confirmLabel={t('config.delete')}
            onConfirm={() => {
              setIsSettingsOpened(false);
              setActiveListId(null);
              channel.deleteList(list.id);
            }}
          >
            <Button variant="subtle" color="red" size="compact-sm" leftSection={<IconTrash size={14} />}>
              {t('config.deleteList')}
            </Button>
          </ConfirmPopover>
        </div>
      </Modal>
    </div>
  );
};

export default ConfigPage;
