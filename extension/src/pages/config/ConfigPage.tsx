import { ActionIcon, Button, Center, Loader, Modal, Text, Title } from '@mantine/core';
import { IconChartPie, IconDots, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AppearanceView from '@domains/appearance/ui/AppearanceView';
import PendingLotsModal from '@domains/integrations/pointauc/ui/PendingLotsModal';
import PointaucImportModal from '@domains/integrations/pointauc/ui/PointaucImportModal';
import { useAddItem } from '@domains/lists/model/useAddItem';
import { streamerActions, useChannel, type AddResult, type ItemStatus, type ListKind } from '@domains/lists/model/useChannel';
import { useBroadcastReload } from '@domains/lists/model/useLiveSync';
import AddItemBar from '@domains/lists/ui/AddItemBar';
import ItemEditModal from '@domains/lists/ui/ItemEditModal';
import RatePromptModal from '@domains/lists/ui/RatePromptModal';
import ListForm from '@domains/lists/ui/ListForm';
import ListsSidebar from '@domains/lists/ui/ListsSidebar';
import QueueColumn from '@domains/lists/ui/QueueColumn';
import WatchedColumn from '@domains/lists/ui/WatchedColumn';
import ConfirmPopover from '@shared/ui/ConfirmPopover';

const NOTICE_MS = 6000;

const ConfigPage = () => {
  const { t } = useTranslation();
  const channel = useChannel();
  useBroadcastReload(channel); // edits made in the panel show up here too
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [isAppearanceOpened, setIsAppearanceOpened] = useState(false);
  const [isSettingsOpened, setIsSettingsOpened] = useState(false);
  const [isPointaucOpened, setIsPointaucOpened] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isPendingOpened, setIsPendingOpened] = useState(false);
  const [ratingId, setRatingId] = useState<number | null>(null);
  const addItem = useAddItem(channel, channel.lists?.find((candidate) => candidate.id === activeListId) ?? channel.lists?.[0]);
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  /** "Added N, skipped M" after a bulk add or an import, for a few seconds (a newer one replaces it). */
  const showResult = (result: AddResult) => {
    const unchecked = result.unchecked ? ` ${t('config.bulkUnchecked', { count: result.unchecked })}` : '';
    setNotice(t('config.bulkResult', { added: result.added.length, skipped: result.skipped }) + unchecked);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };

  const selectList = (listId: number) => {
    setActiveListId(listId);
    setIsAppearanceOpened(false);
  };

  const createList = async (title: string, kind: ListKind) => {
    const list = await channel.createList(title, kind);
    if (list) selectList(list.id);
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
          <Loader color="var(--primary-hi)" role="status" aria-label={t('config.loading')} />
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
  const pendingLots = channel.pendingLots.filter((lot) => lot.list_id === list.id);
  const queue = list.items.filter((item) => item.status === 'queue');
  const watched = list.items.filter((item) => item.status === 'watched');

  const itemActions = streamerActions(channel, setRatingId, setEditingId);
  const syncList = channel.lists.find((candidate) => candidate.id === channel.pointaucListId);

  const importLots = async (lotIds: string[], status: ItemStatus) => {
    const result = await channel.importLots(list.id, lotIds, status);
    if (result) showResult(result);
    return !!result;
  };

  const addBulk = async (titles: string[], status: ItemStatus) => {
    const result = await channel.addBulk(list.id, titles, status);
    if (result) showResult(result);
    return !!result;
  };

  return (
    <div className="grid h-full grid-cols-[210px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3.5 p-3.5">
      <ListsSidebar
        lists={channel.lists}
        activeListId={isAppearanceOpened ? null : list.id}
        onSelect={selectList}
        onAppearance={() => setIsAppearanceOpened(true)}
        onCreate={createList}
        isSaving={channel.isSaving}
        saveError={channel.saveError}
        onDismissError={channel.clearSaveError}
        notice={notice}
      />

      <main className="flex min-h-0 min-w-0 flex-col gap-3">
        {isAppearanceOpened ? (
          <AppearanceView
            theme={channel.theme}
            list={list}
            onPreview={channel.previewTheme}
            onSave={channel.saveTheme}
          />
        ) : (
          <>
            <div className="flex items-center gap-3 px-1 pt-1">
              <Title order={1} size={48} className="min-w-0 flex-1 truncate !leading-[1.25]">
                {list.title}
              </Title>
              {pendingLots.length > 0 && (
                <button type="button" className="chip chip-new" onClick={() => setIsPendingOpened(true)}>
                  {t('pending.banner', { count: pendingLots.length })}
                </button>
              )}
              <Button variant="default" leftSection={<IconChartPie size={16} />} onClick={() => setIsPointaucOpened(true)}>
                {t('pointauc.open')}
              </Button>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={t('config.listSettings')}
                onClick={() => setIsSettingsOpened(true)}
              >
                <IconDots size={18} />
              </ActionIcon>
            </div>

            <AddItemBar
              kind={list.kind}
              onAdd={addItem}
              onBulk={addBulk}
            />

            <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-3">
              <QueueColumn
                kind={list.kind}
                items={queue}
                onReorder={(ids) => channel.reorderQueue(list.id, ids)}
                {...itemActions}
              />
              <WatchedColumn kind={list.kind} items={watched} {...itemActions} />
            </div>
          </>
        )}
      </main>

      <PendingLotsModal
        opened={isPendingOpened && pendingLots.length > 0}
        onClose={() => setIsPendingOpened(false)}
        lots={pendingLots}
        withSuggestions={list.kind === 'movies'}
        onAccept={channel.acceptPending}
        onDismiss={channel.dismissPending}
      />

      <RatePromptModal
        item={list.items.find((item) => item.id === ratingId) ?? null}
        onRate={(itemId, rating) => channel.editItem(itemId, { rating })}
        onClose={() => setRatingId(null)}
      />

      <ItemEditModal
        item={list.items.find((item) => item.id === editingId) ?? null}
        kind={list.kind}
        onClose={() => setEditingId(null)}
        onSave={channel.editItem}
      />

      <PointaucImportModal
        opened={isPointaucOpened}
        onClose={() => setIsPointaucOpened(false)}
        listId={list.id}
        kind={list.kind}
        isConnected={channel.isPointaucConnected}
        onConnect={channel.connectPointauc}
        onDisconnect={channel.disconnectPointauc}
        syncListId={channel.pointaucListId}
        syncListTitle={syncList?.title ?? null}
        saveError={channel.saveError}
        onToggleSync={(isOn) => channel.setPointaucSync(isOn ? list.id : null)}
        onImport={importLots}
      />

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
