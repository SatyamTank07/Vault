import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';
import ui from './ui.module.css';

interface DateChipProps {
  /** YYYY-MM-DD, or null when the note has no date yet (drawn dashed). */
  date: string | null | undefined;
  /** Text shown when a date is set, e.g. "Mar 4 – Mar 9 · 9:00 AM". */
  text?: string;
  onChange: (date: string | null) => void;
}

/** One date chip style everywhere: dashed means "no date yet". Opens the native date picker. */
export const DateChip: React.FC<DateChipProps> = ({ date, text, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const open = (event: React.MouseEvent) => {
    event.stopPropagation();
    const input = inputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  };

  return (
    <button
      type="button"
      className={`${ui.dateChip} ${date ? ui.dateSet : ''} nodrag`}
      onClick={open}
      title={date ? 'Change date' : 'Set a date'}
      aria-label={date ? `Date: ${text || date}. Change date` : 'Set a date'}
    >
      <Calendar size={13} />
      {date && text ? <span>{text}</span> : null}
      <input
        ref={inputRef}
        type="date"
        className={ui.hiddenDate}
        value={date || ''}
        onChange={(event) => onChange(event.target.value || null)}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
        aria-hidden="true"
      />
    </button>
  );
};
