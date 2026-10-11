import { CloseButton, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

type Props = { value: string; onChange: (value: string) => void; label: string; className: string };

/** A panel's search field: the label is its placeholder too; the cross clears it and keeps the focus in it. */
export default function SearchField({ value, onChange, label, className }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <TextInput
      ref={ref}
      className={className}
      size="xs"
      leftSection={<IconSearch size={14} />}
      rightSectionPointerEvents="all"
      rightSection={
        !!value.trim() && (
          <CloseButton
            size="sm"
            aria-label={t('panel.clear')}
            onClick={() => {
              onChange('');
              ref.current?.focus();
            }}
          />
        )
      }
      placeholder={label}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
