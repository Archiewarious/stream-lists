export type ListKind = 'games' | 'movies' | 'custom';

export type ItemStatus = 'now' | 'queue' | 'done';

export interface ListItem {
  id: string;
  title: string;
  status: ItemStatus;
}

export interface StreamList {
  id: string;
  title: string;
  kind: ListKind;
  items: ListItem[];
}

export interface ChannelLists {
  lists: StreamList[];
}

export type ChannelListsChange = (current: ChannelLists) => ChannelLists;
