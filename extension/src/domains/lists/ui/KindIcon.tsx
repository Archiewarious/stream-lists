import { IconDeviceGamepad2, IconListDetails, IconMovie } from '@tabler/icons-react';

import type { ListKind } from '@domains/lists/model/useChannel';

const ICONS = {
  games: IconDeviceGamepad2,
  movies: IconMovie,
  custom: IconListDetails,
} as const;

interface KindIconProps {
  kind: ListKind;
  size?: number;
}

const KindIcon = ({ kind, size = 16 }: KindIconProps) => {
  const Icon = ICONS[kind];
  return <Icon size={size} stroke={1.75} />;
};

export default KindIcon;
