import { Button, Group, Popover, Text } from '@mantine/core';
import { useState, type ReactNode } from 'react';

interface ConfirmPopoverProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** The button that opens the question. */
  children: ReactNode;
}

/** "Are you sure?" next to the button — Twitch's iframe may block window.confirm. */
const ConfirmPopover = ({ message, confirmLabel, onConfirm, children }: ConfirmPopoverProps) => {
  const [isOpened, setIsOpened] = useState(false);

  return (
    <Popover opened={isOpened} onChange={setIsOpened} position="bottom-end" width={260} trapFocus>
      <Popover.Target>
        <span className="inline-flex" onClick={() => setIsOpened((opened) => !opened)}>
          {children}
        </span>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="sm" fw={700} p={4}>
          {message}
        </Text>
        <Group justify="flex-end" mt="xs">
          <Button
            size="compact-sm"
            variant="light"
            color="red"
            data-autofocus
            onClick={() => {
              setIsOpened(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
};

export default ConfirmPopover;
