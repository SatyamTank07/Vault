import React, { useState, useRef, useEffect } from 'react';
import { Calendar, Repeat, Check, ChevronDown } from 'lucide-react';
import { useDecryptedHtml } from '../../lib/imageDecryption';
import styles from './NoteCard.module.css';

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string;
  canvas_name?: string;
  recurrence_rule?: string | null;
  recurrence_interval?: number;
  recurrence_end_date?: string | null;
  end_date?: string | null;
}

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onView: (note: Note) => void;
  onUpdateSchedule?: (noteId: string, date: string | null, time: string | null, status: string) => void;
  onRecurrenceClick?: (note: Note) => void;
  cryptoKey?: CryptoKey | null;
}

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do', color: '#9CA3AF' },
  { value: 'in_progress', label: 'In Progress', color: '#F59E0B' },
  { value: 'done', label: 'Done', color: '#10B981' },
] as const;

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function buildRecurrenceTooltip(note: Note): string {
  if (!note.recurrence_rule) return 'Set recurrence';
  const rule = RECURRENCE_LABELS[note.recurrence_rule] || note.recurrence_rule;
  const interval = note.recurrence_interval || 1;
  const frequency =
    interval === 1
      ? rule
      : `Every ${interval} ${
          note.recurrence_rule === 'daily'
            ? 'days'
            : note.recurrence_rule === 'weekly'
              ? 'weeks'
              : 'months'
        }`;
  const end = note.recurrence_end_date
    ? ` until ${new Date(note.recurrence_end_date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`
    : ' Forever';
  return `${frequency}${end} - Click to edit`;
}

export const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onEdit,
  onDelete,
  onView,
  onUpdateSchedule,
  onRecurrenceClick,
  cryptoKey,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const decryptedHtml = useDecryptedHtml(note.content || '', cryptoKey);

  const currentStatus = note.status || 'todo';
  const isDone = currentStatus === 'done';

  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const handleToggleDropdown = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsDropdownOpen((prev) => !prev);
  };

  const handleSelectStatus = (event: React.MouseEvent, newStatus: string) => {
    event.stopPropagation();
    setIsDropdownOpen(false);
    if (newStatus !== currentStatus) {
      onUpdateSchedule?.(note.id, note.scheduled_date, note.scheduled_time, newStatus);
    }
  };

  const handleDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const newDate = event.target.value || null;
    onUpdateSchedule?.(note.id, newDate, note.scheduled_time, currentStatus);
  };

  const handleCalendarClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    dateInputRef.current?.showPicker();
  };

  const handleRecurrenceClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onRecurrenceClick?.(note);
  };

  return (
    <div
      className={`${styles.card} ${isDropdownOpen ? styles.cardDropdownOpen : ''}`}
      onClick={() => onView(note)}
    >
      <div className={styles.headerRow}>
        <div className={styles.titleWrapper}>
          <div className={styles.titleContent}>
            <div className={styles.badgeRow}>
              <span className={styles.canvasName}>{note.canvas_name || 'Independent Note'}</span>
              <div
                className={styles.statusDropdownWrapper}
                ref={dropdownRef}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setIsDropdownOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  className={`${styles.statusBadge} ${styles[`statusBadge_${currentStatus}`]}`}
                  onClick={handleToggleDropdown}
                  title={`Status: ${STATUS_LABELS[currentStatus]} (click to change)`}
                  aria-haspopup="listbox"
                  aria-expanded={isDropdownOpen}
                >
                  <span className={styles.statusDot} />
                  <span className={styles.statusLabel}>{STATUS_LABELS[currentStatus]}</span>
                  <ChevronDown
                    size={11}
                    className={`${styles.statusChevron} ${isDropdownOpen ? styles.statusChevronOpen : ''}`}
                  />
                </button>

                {isDropdownOpen && (
                  <div
                    className={styles.statusDropdownMenu}
                    role="listbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {STATUS_OPTIONS.map((option) => {
                      const isSelected = option.value === currentStatus;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`${styles.statusOption} ${isSelected ? styles.statusOptionSelected : ''}`}
                          onClick={(e) => handleSelectStatus(e, option.value)}
                        >
                          <span className={styles.optionDot} style={{ backgroundColor: option.color }} />
                          <span className={styles.optionLabel}>{option.label}</span>
                          {isSelected && <Check size={12} className={styles.optionCheck} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.titleRow}>
              <h3 className={`${styles.title} ${isDone ? styles.titleDone : ''}`}>{note.title || 'Untitled'}</h3>
            </div>
          </div>
        </div>

        <div className={styles.headerRight} onClick={(event) => event.stopPropagation()}>
          {note.scheduled_date && (
            <button
              className={`${styles.recurrenceBtn} ${note.recurrence_rule ? styles.recurrenceBtnActive : ''}`}
              onClick={handleRecurrenceClick}
              title={buildRecurrenceTooltip(note)}
            >
              <Repeat size={13} />
            </button>
          )}

          <div className={styles.scheduleWrapper} title="Set scheduled date and time">
            <div className={`${styles.calendarBtn} ${note.scheduled_date ? styles.active : ''}`} onClick={handleCalendarClick}>
              <Calendar size={14} />
              <input
                ref={dateInputRef}
                type="date"
                className={styles.hiddenDateInput}
                value={note.scheduled_date || ''}
                onChange={handleDateChange}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.description} dangerouslySetInnerHTML={{ __html: decryptedHtml }} />

      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          <span>{formatDate(note.created_at)}</span>
          {note.updated_at && note.updated_at !== note.created_at && (
            <span className={styles.editedTag} title="Edited">
              · Edited
            </span>
          )}
        </div>

        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={(event) => {
              event.stopPropagation();
              onEdit(note);
            }}
            title="Edit"
          >
            ✎
          </button>
          <button
            className={`${styles.actionBtn} ${styles.deleteBtn}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(note.id);
            }}
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};
