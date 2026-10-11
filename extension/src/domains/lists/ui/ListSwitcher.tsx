import { Menu } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

import type { ListKind } from '@domains/lists/model/useChannel';
import KindIcon from '@domains/lists/ui/KindIcon';

interface ListSwitcherProps {
  lists: { id: number; title: string; kind: ListKind }[];
  active: { id: number; title: string };
  onSelect: (listId: number) => void;
}

/** The list title in script type; with several lists it opens a menu to switch. */
const ListSwitcher = ({ lists, active, onSelect }: ListSwitcherProps) => (
  <Menu position="bottom-start" disabled={lists.length < 2}>
    <Menu.Target>
      <button type="button" className="script flex min-w-0 items-center gap-1.5 pl-0.5 text-[30px]" title={active.title}>
        <span className="truncate leading-[1.2]">{active.title}</span>
        {lists.length > 1 && <IconChevronDown size={14} className="shrink-0 text-fg-2" />}
      </button>
    </Menu.Target>
    <Menu.Dropdown>
      {lists.map((candidate) => (
        <Menu.Item key={candidate.id} leftSection={<KindIcon kind={candidate.kind} />} onClick={() => onSelect(candidate.id)}>
          {candidate.title}
        </Menu.Item>
      ))}
    </Menu.Dropdown>
  </Menu>
);

export default ListSwitcher;
