import { useDroppable } from '@dnd-kit/core';
import { ALL_GROUP_ID, type ProjectGroup, UNGROUPED_GROUP_ID } from '@shared/projectGroups';
import { Check, ChevronDown, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { selectorGroupDropId } from '@/components/chat/dragDrop';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface GroupSelectorProps {
  groups: readonly ProjectGroup[];
  selectedId: string;
  counts: Record<string, number>;
  totalCount: number;
  ungroupedCount: number;
  onSelect: (id: string) => void;
  onAddGroup: () => void;
  onEditGroup: (id: string) => void;
}

export function GroupSelector({
  groups,
  selectedId,
  counts,
  totalCount,
  ungroupedCount,
  onSelect,
  onAddGroup,
  onEditGroup,
}: GroupSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = groups.find((group) => group.id === selectedId);
  const isAll = selectedId === ALL_GROUP_ID;
  const isUngrouped = selectedId === UNGROUPED_GROUP_ID;
  const label = isAll ? t('All') : isUngrouped ? t('Ungrouped') : (selected?.name ?? t('All'));
  const count = isAll ? totalCount : isUngrouped ? ungroupedCount : (counts[selectedId] ?? 0);
  const ordered = groups.slice().sort((a, b) => a.order - b.order);

  const closeAnd = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative border-b">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex h-10 w-full cursor-pointer items-center gap-2 px-3 text-sm transition-colors hover:bg-accent/50"
      >
        {!isAll && !isUngrouped && selected?.emoji && (
          <span className="w-5 shrink-0 text-center text-base">{selected.emoji}</span>
        )}
        {!isAll && !isUngrouped && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border"
            style={{ backgroundColor: selected?.color }}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
          {count}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
        <span
          role="button"
          tabIndex={0}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          title={isAll || isUngrouped ? t('New group') : t('Edit group')}
          onClick={(event) => {
            event.stopPropagation();
            if (isAll || isUngrouped) onAddGroup();
            else onEditGroup(selectedId);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.stopPropagation();
            if (isAll || isUngrouped) onAddGroup();
            else onEditGroup(selectedId);
          }}
        >
          {isAll || isUngrouped ? <Plus className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
            role="presentation"
          />
          <div className="absolute top-full right-0 left-0 z-50 mt-1 rounded-lg border bg-popover p-1 shadow-lg">
            <SelectorRow
              dropId={selectorGroupDropId(ALL_GROUP_ID)}
              label={t('All')}
              count={totalCount}
              selected={isAll}
              onSelect={() => closeAnd(() => onSelect(ALL_GROUP_ID))}
            />
            {(ordered.length > 0 || ungroupedCount > 0) && <div className="my-1 h-px bg-border" />}
            {ordered.map((group) => (
              <SelectorRow
                key={group.id}
                dropId={selectorGroupDropId(group.id)}
                label={group.name}
                emoji={group.emoji}
                color={group.color}
                count={counts[group.id] ?? 0}
                selected={selectedId === group.id}
                onSelect={() => closeAnd(() => onSelect(group.id))}
                onEdit={() => closeAnd(() => onEditGroup(group.id))}
              />
            ))}
            <SelectorRow
              dropId={selectorGroupDropId(UNGROUPED_GROUP_ID)}
              label={t('Ungrouped')}
              count={ungroupedCount}
              selected={isUngrouped}
              onSelect={() => closeAnd(() => onSelect(UNGROUPED_GROUP_ID))}
            />
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeAnd(onAddGroup);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              <span>{t('New group')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SelectorRow({
  dropId,
  label,
  emoji,
  color,
  count,
  selected,
  onSelect,
  onEdit,
}: {
  dropId: string;
  label: string;
  emoji?: string;
  color?: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
}) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className={cn(
        'group/item flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50',
        isOver && 'bg-accent/60'
      )}
    >
      {emoji !== undefined && <span className="w-5 shrink-0 text-center text-base">{emoji}</span>}
      {color !== undefined && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
      {selected ? (
        <Check className="h-4 w-4 shrink-0 text-primary" />
      ) : onEdit ? (
        <span
          role="button"
          tabIndex={0}
          title={t('Edit group')}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </button>
  );
}
