import { Button, Modal } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import type { ItemRow } from '@worker/snapshot';
import Poster from '@shared/ui/Poster';

const RATINGS = Array.from({ length: 10 }, (_, index) => index + 1);

interface RatePromptModalProps {
  /** The title that has just become watched; null — closed. */
  item: ItemRow | null;
  onRate: (itemId: number, rating: number) => void;
  onClose: () => void;
  isFullScreen?: boolean;
}

/** Asked right after a title is marked watched: one tap of 1–10, or skip. */
const RatePromptModal = ({ item, onRate, onClose, isFullScreen }: RatePromptModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal
      opened={!!item}
      onClose={onClose}
      fullScreen={isFullScreen}
      centered
      size={360}
      title={<span className="script text-4xl">{t('rating.prompt')}</span>}
    >
      {item && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Poster path={item.poster_path} width={44} />
            <span className="min-w-0 flex-1 text-base font-extrabold leading-tight">{item.title}</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {RATINGS.map((value) => (
              <Button
                key={value}
                variant="default"
                size="md"
                onClick={() => {
                  onRate(item.id, value);
                  onClose();
                }}
              >
                {value}
              </Button>
            ))}
          </div>
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('rating.skip')}
          </Button>
        </div>
      )}
    </Modal>
  );
};

export default RatePromptModal;
