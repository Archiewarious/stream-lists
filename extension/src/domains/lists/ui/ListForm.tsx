import { Button, SegmentedControl, Stack, TextInput } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListKind } from '@domains/lists/model/useChannel';

const KINDS: ListKind[] = ['movies', 'games', 'custom'];
const MAX_TITLE_LENGTH = 40;

interface ListFormProps {
  initialTitle?: string;
  initialKind?: ListKind;
  submitLabel: string;
  onSubmit: (title: string, kind: ListKind) => void;
}

/** Name and type of a list — for a new list and for list settings. An empty name falls back to the type. */
const ListForm = ({ initialTitle = '', initialKind = 'movies', submitLabel, onSubmit }: ListFormProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [kind, setKind] = useState<ListKind>(initialKind);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(title.trim() || t(`kindsShort.${kind}`), kind);
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(value) => setKind(value as ListKind)}
          data={KINDS.map((value) => ({ value, label: t(`kindsShort.${value}`) }))}
        />
        <TextInput
          label={t('config.listTitle')}
          placeholder={t(`kindsShort.${kind}`)}
          maxLength={MAX_TITLE_LENGTH}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          data-autofocus
        />
        <Button type="submit">{submitLabel}</Button>
      </Stack>
    </form>
  );
};

export default ListForm;
