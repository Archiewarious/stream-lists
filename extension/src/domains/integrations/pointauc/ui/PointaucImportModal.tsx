import { Anchor, Button, Checkbox, Group, Loader, Modal, PasswordInput, ScrollArea, Text } from '@mantine/core';
import { IconCheck, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ImportLot } from '@worker/pointauc';
import { formatDay } from '@domains/lists/lib/items';
import type { ItemStatus, ListKind } from '@domains/lists/model/useChannel';
import { callWorker } from '@shared/api/workerApi';

interface PointaucImportModalProps {
  opened: boolean;
  onClose: () => void;
  listId: number;
  kind: ListKind;
  isConnected: boolean;
  onConnect: (token: string) => Promise<void>;
  onDisconnect: () => void;
  /** Resolves false when saving failed — the dialog and the selection stay. */
  onImport: (lotIds: string[], status: ItemStatus) => Promise<boolean>;
}

const ConnectForm = ({ onConnect }: Pick<PointaucImportModalProps, 'onConnect'>) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onConnect(token.trim());
    } catch {
      setError(t('pointauc.connectFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-1 pb-2">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-2">
        <li>{t('pointauc.step1')}</li>
        <li>{t('pointauc.step2')}</li>
        <li>{t('pointauc.step3')}</li>
      </ol>
      <PasswordInput
        label={t('pointauc.token')}
        value={token}
        onChange={(event) => setToken(event.currentTarget.value)}
        error={error}
        autoComplete="off"
        data-autofocus
      />
      <Text size="xs" c="dimmed">
        {t('pointauc.tokenSafety')}
      </Text>
      <Group justify="flex-end">
        <Button type="submit" loading={isSaving} disabled={!token.trim()}>
          {t('pointauc.connect')}
        </Button>
      </Group>
    </form>
  );
};

/** Lots of the current Pointauc auction → this list. New lots are preselected; known ones are shown with their status. */
const PointaucImportModal = (props: PointaucImportModalProps) => {
  const { opened, onClose, listId, kind, isConnected, onConnect, onDisconnect, onImport } = props;
  const { t, i18n } = useTranslation();
  const [lots, setLots] = useState<ImportLot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);

  const loadLots = useCallback(async () => {
    setLots(null);
    setLoadError(null);
    try {
      const nextLots = await callWorker<ImportLot[]>('GET', `/api/pointauc/lots?list_id=${listId}`);
      setLots(nextLots);
      setSelected(new Set(nextLots.filter((lot) => lot.status === 'new').map((lot) => lot.id)));
    } catch {
      setLoadError(t('pointauc.loadFailed'));
    }
  }, [listId, t]);

  useEffect(() => {
    if (opened && isConnected) loadLots();
  }, [opened, isConnected, loadLots]);

  const toggle = (lotId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(lotId)) next.add(lotId);
      return next;
    });

  const importSelected = async (status: ItemStatus) => {
    setIsImporting(true);
    const isSaved = await onImport(
      (lots ?? []).filter((lot) => selected.has(lot.id)).map((lot) => lot.id),
      status,
    );
    setIsImporting(false);
    if (isSaved) onClose();
  };

  const chip = (lot: ImportLot) => {
    if (lot.status === 'new') return <span className="chip chip-new">{t('appearance.newChip')}</span>;
    if (lot.status === 'queue') return <span className="chip chip-queue">{t('panel.inQueue', { position: lot.position })}</span>;
    return (
      <span className="chip chip-seen">
        {t(`columns.${kind}.seenChip`, { date: formatDay(lot.watched_at ?? 0, i18n.language) })}
      </span>
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={620}
      centered
      title={
        <span>
          <span className="script block text-4xl">{t('pointauc.title')}</span>
          <span className="mt-1 block text-sm text-fg-2">
            {isConnected ? t('pointauc.subtitle') : t('pointauc.connectSubtitle')}
          </span>
        </span>
      }
    >
      {!isConnected ? (
        <ConnectForm onConnect={onConnect} />
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Text size="sm" fw={700} maw={420}>
            {loadError}
          </Text>
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={loadLots}>
            {t('pointauc.retry')}
          </Button>
          <Anchor component="button" type="button" size="xs" c="dimmed" onClick={onDisconnect}>
            {t('pointauc.disconnect')}
          </Anchor>
        </div>
      ) : !lots ? (
        <div className="flex justify-center py-10">
          <Loader color="var(--primary-hi)" />
        </div>
      ) : !lots.length ? (
        <Text ta="center" py="xl" c="dimmed" fw={700}>
          {t('pointauc.empty')}
        </Text>
      ) : (
        <>
          <ScrollArea.Autosize mah={380}>
            {lots.map((lot) => (
              <label
                key={lot.id}
                className={`flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2 text-sm font-bold hover:selected ${
                  lot.status === 'new' ? '' : 'text-fg-3'
                }`}
              >
                <Checkbox checked={selected.has(lot.id)} onChange={() => toggle(lot.id)} />
                <span className="min-w-0 flex-1 truncate">{lot.name}</span>
                {chip(lot)}
                <span className="w-14 text-right text-xs text-fg-2 tabular-nums">{lot.amount.toLocaleString(i18n.language)}</span>
              </label>
            ))}
          </ScrollArea.Autosize>
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-white/10 pt-3.5">
            <span className="min-w-0 flex-1 text-xs text-fg-2">{t('pointauc.noRepeats')}</span>
            <Button
              variant="default"
              leftSection={<IconCheck size={16} />}
              disabled={!selected.size}
              loading={isImporting}
              onClick={() => importSelected('watched')}
            >
              {t(`columns.${kind}.toWatched`)}
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              disabled={!selected.size}
              loading={isImporting}
              onClick={() => importSelected('queue')}
            >
              {t('config.bulkToQueue', { count: selected.size })}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};

export default PointaucImportModal;
