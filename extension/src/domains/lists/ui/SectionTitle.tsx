import { Badge, Group, Text } from '@mantine/core';

interface SectionTitleProps {
  label: string;
  count?: number;
  isAccent?: boolean;
}

const SectionTitle = ({ label, count, isAccent = false }: SectionTitleProps) => (
  <Group gap={6}>
    <Text size="xs" fw={700} tt="uppercase" c={isAccent ? 'var(--mantine-primary-color-filled)' : 'dimmed'}>
      {label}
    </Text>
    {count !== undefined && (
      <Badge size="xs" variant="default">
        {count}
      </Badge>
    )}
  </Group>
);

export default SectionTitle;
