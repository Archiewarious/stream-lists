import { Button, SegmentedControl, Stack, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { LIST_KINDS, MAX_LIST_TITLE_LENGTH } from '@domains/lists/lib/channelLists';
import type { ListKind } from '@domains/lists/model/types';

interface NewListFormProps {
  onCreate: (title: string, kind: ListKind) => void;
}

const NewListForm = ({ onCreate }: NewListFormProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ListKind>('games');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onCreate(title.trim() || t(`kinds.${kind}`), kind);
    setTitle('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(value) => setKind(value as ListKind)}
          data={LIST_KINDS.map((listKind) => ({ value: listKind, label: t(`kinds.${listKind}`) }))}
        />
        <TextInput
          label={t('config.listTitle')}
          placeholder={t(`kinds.${kind}`)}
          value={title}
          maxLength={MAX_LIST_TITLE_LENGTH}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Button type="submit" leftSection={<IconPlus size={16} />}>
          {t('config.create')}
        </Button>
      </Stack>
    </form>
  );
};

export default NewListForm;
