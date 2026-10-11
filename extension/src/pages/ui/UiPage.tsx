import { Autocomplete, Button, Checkbox, Modal, SegmentedControl, TextInput, Title } from '@mantine/core';
import { IconCheck, IconChartPie, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';

import { applyTheme, PRESETS, type PresetId } from '@app/presets';
import Poster from '@shared/ui/Poster';

const QUEUE: [string, number, string][] = [
  ['Интерстеллар', 2014, '/vReLRjDV9XPhiOSEW7QWow4DXwf.jpg'],
  ['Аркейн', 2021, '/kVioUjk1SXGWblJNaKsIJcBqUcY.jpg'],
  ['Бегущий по лезвию 2049', 2017, '/fnIJeT9GZvscKm5PbmAvhTYDsLh.jpg'],
  ['Начало', 2010, '/piQXcdOGgv1O9HQ07pI0tnjkGJw.jpg'],
  ['Остров проклятых', 2010, '/3UVMyefkUBiktshtKIEnNXvOFKH.jpg'],
  ['Без постера', 2006, ''],
];

/** Dev-only showcase of the theme and glass components (ui.html, not part of the build). */
const UiPage = () => {
  const [preset, setPreset] = useState<PresetId>('fox');
  const [tab, setTab] = useState('queue');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const pickPreset = (id: PresetId) => {
    setPreset(id);
    applyTheme({ preset: id });
  };

  return (
    <div className="flex flex-wrap items-start gap-8 p-8">
      <div className="glass flex h-[500px] w-[318px] flex-col gap-2.5 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <span className="script pl-0.5 text-[30px]">Фильмы</span>
          <TextInput className="ml-auto w-40" size="xs" leftSection={<IconSearch size={14} />} placeholder="Найти фильм" />
        </div>
        <SegmentedControl
          size="xs"
          fullWidth
          value={tab}
          onChange={setTab}
          data={[
            { value: 'queue', label: 'Очередь 18' },
            { value: 'watched', label: 'Просмотрено 54' },
          ]}
        />
        <div className="glass-soft flex-1 overflow-hidden rounded-[18px] p-1.5">
          {QUEUE.map(([title, year, path], i) => (
            <div key={title} className={`flex h-[46px] items-center gap-2.5 rounded-xl px-1.5 text-[13px] font-bold ${i === 1 ? 'selected' : ''}`}>
              <span className="w-3.5 text-right text-[11px] text-fg-3">{i + 1}</span>
              <Poster path={path} width={24} />
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <span className="text-xs text-fg-3">{year}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex max-w-[620px] flex-col gap-5">
        <Title order={1} size={48}>
          Оформление
        </Title>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <Button key={id} variant={id === preset ? 'filled' : 'default'} onClick={() => pickPreset(id)}>
              {id}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button leftSection={<IconCheck size={16} />}>Просмотрено</Button>
          <Button variant="default" leftSection={<IconChartPie size={16} />}>
            Из Pointauc
          </Button>
          <Button disabled>Недоступно</Button>
          <Button variant="default" onClick={() => setIsModalOpen(true)}>
            Диалог
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-seen">Смотрели 18 сент</span>
          <span className="chip">В очереди · 7</span>
          <span className="chip chip-new">Новый</span>
          <span className="label ml-2">Сентябрь 2026</span>
        </div>
        <div className="flex gap-4">
          <Checkbox defaultChecked label="Список Шиндлера" />
          <Checkbox label="Матрица" />
        </div>
        <Autocomplete
          size="md"
          leftSection={<IconSearch size={16} />}
          placeholder="Найти фильм — постер и год подтянутся сами"
          data={['Дюна: Часть вторая', 'Дюна', 'Дюна (1984)']}
        />
      </div>

      <Modal opened={isModalOpen} onClose={() => setIsModalOpen(false)} title={<span className="script text-4xl">Лоты из Pointauc</span>} centered>
        <p className="text-sm text-fg-2">Просмотренные и стоящие в очереди не добавятся повторно</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setIsModalOpen(false)}>В очередь · 4</Button>
        </div>
      </Modal>
    </div>
  );
};

export default UiPage;
