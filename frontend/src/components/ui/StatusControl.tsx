import React, { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Menu, MenuItem } from './Menu';
import { normalizeStatus, STATUS_LABELS, type TaskStatus } from '../../lib/noteText';
import { statusClass } from './statusClass';
import ui from './ui.module.css';

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done'];
const DOT_VAR: Record<TaskStatus, string> = {
  todo: 'var(--todo-dot)',
  in_progress: 'var(--prog-dot)',
  done: 'var(--done-dot)',
};

interface StatusControlProps {
  status: string | null | undefined;
  /** Omit to render a read-only indicator. */
  onChange?: (status: TaskStatus) => void;
  /** Extra label for screen readers, e.g. the task title. */
  label?: string;
}

function useStatusMenu(onChange?: (status: TaskStatus) => void) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const toggle = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!onChange) return;
    const target = event.currentTarget;
    setAnchor((prev) => (prev ? null : target));
  };
  return { anchor, close, toggle };
}

function StatusMenu({
  anchor,
  current,
  onClose,
  onChange,
}: {
  anchor: HTMLElement | null;
  current: TaskStatus;
  onClose: () => void;
  onChange?: (status: TaskStatus) => void;
}) {
  return (
    <Menu anchor={anchor} open={anchor !== null} onClose={onClose} label="Status" minWidth={168}>
      {STATUS_ORDER.map((s) => (
        <MenuItem
          key={s}
          selected={s === current}
          icon={<span className={ui.optDot} style={{ background: DOT_VAR[s] }} />}
          onSelect={() => {
            onClose();
            if (s !== current) onChange?.(s);
          }}
        >
          {STATUS_LABELS[s]}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** "● In progress ⌄" pill that opens the shared To do / In progress / Done menu. */
export const StatusPill: React.FC<StatusControlProps & { large?: boolean }> = ({ status, onChange, label, large }) => {
  const current = normalizeStatus(status);
  const { anchor, close, toggle } = useStatusMenu(onChange);
  const className = `${ui.pill} ${large ? ui.pillLg : ''} ${statusClass(current)} nodrag`;
  const text = STATUS_LABELS[current];

  if (!onChange) {
    return (
      <span className={className}>
        <span className={ui.pillDot} />
        {text}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={`Status: ${text}${label ? ` for ${label}` : ''}. Change status`}
        title={`Status: ${text}`}
      >
        <span className={ui.pillDot} />
        {text}
        <ChevronDown size={12} />
      </button>
      <StatusMenu anchor={anchor} current={current} onClose={close} onChange={onChange} />
    </>
  );
};

/** A small status ring for dense rows (schedule tasks, bars, event panel). */
export const StatusDot: React.FC<StatusControlProps & { small?: boolean }> = ({ status, onChange, label, small }) => {
  const current = normalizeStatus(status);
  const { anchor, close, toggle } = useStatusMenu(onChange);
  const className = `${ui.sdot} ${small ? ui.sdotSm : ''} ${statusClass(current)} nodrag`;
  const text = STATUS_LABELS[current];

  if (!onChange) {
    return <span className={className} role="img" aria-label={`Status: ${text}`} title={`Status: ${text}`} />;
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={`Status: ${text}${label ? ` for ${label}` : ''}. Change status`}
        title={`Status: ${text}`}
      />
      <StatusMenu anchor={anchor} current={current} onClose={close} onChange={onChange} />
    </>
  );
};
