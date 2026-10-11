import { Popover } from '@mantine/core';
import { IconAlertTriangle, IconCloudCheck, IconLoader2, IconPalette, IconPlus, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelList } from '@worker/snapshot';
import type { ListKind } from '@domains/lists/model/useChannel';
import KindIcon from '@domains/lists/ui/KindIcon';
import ListForm from '@domains/lists/ui/ListForm';

interface ListsSidebarProps {
  lists: ChannelList[];
  /** null while the appearance screen is open. */
  activeListId: number | null;
  onSelect: (listId: number) => void;
  onAppearance: () => void;
  onCreate: (title: string, kind: ListKind) => void;
  isSaving: boolean;
  saveError: string | null;
  onDismissError: () => void;
  notice: string | null;
}

const ListsSidebar = (props: ListsSidebarProps) => {
  const { lists, activeListId, onSelect, onAppearance, onCreate, isSaving, saveError, onDismissError, notice } = props;
  const { t } = useTranslation();
  const [isNewListOpened, setIsNewListOpened] = useState(false);

  return (
    <aside className="glass flex min-h-0 flex-col rounded-[22px] px-3 py-[18px]">
      <div className="script px-2 pb-5 text-[28px]">Stream Lists</div>
      <div className="label px-2 pb-2">{t('config.yourLists')}</div>

      <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {lists.map((list) => (
          <button
            key={list.id}
            type="button"
            onClick={() => onSelect(list.id)}
            className={`flex items-center gap-2.5 rounded-[14px] p-2.5 text-left text-sm font-bold ${
              list.id === activeListId ? 'selected text-fg' : 'text-fg-2 hover:bg-white/5'
            }`}
          >
            <KindIcon kind={list.kind} size={18} />
            <span className="min-w-0 flex-1 truncate">{list.title}</span>
            <span className="text-xs text-fg-3">{list.items.length}</span>
          </button>
        ))}
      </nav>

      <Popover opened={isNewListOpened} onChange={setIsNewListOpened} position="right-start" width={300} trapFocus>
        <Popover.Target>
          <button
            type="button"
            onClick={() => setIsNewListOpened((opened) => !opened)}
            className="mx-2.5 mt-2 flex items-center gap-2 py-2 text-sm font-bold text-[var(--primary-text)]"
          >
            <IconPlus size={18} />
            {t('config.newList')}
          </button>
        </Popover.Target>
        <Popover.Dropdown>
          <ListForm
            submitLabel={t('config.create')}
            onSubmit={(title, kind) => {
              setIsNewListOpened(false);
              onCreate(title, kind);
            }}
          />
        </Popover.Dropdown>
      </Popover>

      <button
        type="button"
        onClick={onAppearance}
        className={`mt-auto flex items-center gap-2.5 rounded-[14px] p-2.5 text-left text-sm font-bold ${
          activeListId === null ? 'selected text-fg' : 'text-fg-2 hover:bg-white/5'
        }`}
      >
        <IconPalette size={18} />
        {t('appearance.title')}
      </button>

      <div className="flex items-start gap-2 px-2.5 pt-3 text-xs text-fg-3" role={saveError ? 'alert' : 'status'}>
        {saveError ? (
          <>
            <IconAlertTriangle size={15} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 flex-1 text-fg-2">{t('config.saveFailed', { error: saveError })}</span>
            <button type="button" aria-label={t('common.close')} onClick={onDismissError}>
              <IconX size={14} />
            </button>
          </>
        ) : isSaving ? (
          <>
            <IconLoader2 size={15} className="shrink-0 animate-spin" />
            {t('config.saving')}
          </>
        ) : (
          <>
            <IconCloudCheck size={15} className="shrink-0" />
            {notice ?? t('config.saved')}
          </>
        )}
      </div>
    </aside>
  );
};

export default ListsSidebar;
