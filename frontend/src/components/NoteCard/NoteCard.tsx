import React from 'react';
import { CornerDownRight, Pencil, Repeat, Trash2 } from 'lucide-react';
import { useDecryptedHtml } from '../../lib/imageDecryption';
import { checklistProgress, describeRecurrence, formatNoteDate, isTask as isTaskNote } from '../../lib/noteText';
import { DateChip } from '../ui/DateChip';
import { StatusPill } from '../ui/StatusControl';
import ui from '../ui/ui.module.css';
import styles from './NoteCard.module.css';

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string | null;
  canvas_name?: string | null;
  recurrence_rule?: string | null;
  recurrence_interval?: number;
  recurrence_end_date?: string | null;
  end_date?: string | null;
  parent_note_id?: string | null;
  canvas_only?: boolean;
}

interface NoteCardProps {
  note: Note;
  onOpen: (note: Note) => void;
  onDelete: (id: string) => void;
  onUpdateSchedule?: (noteId: string, date: string | null, time: string | null, status: string) => void;
  /** Open the editor with its schedule popover (repeat, time, end date). */
  onEditSchedule?: (note: Note) => void;
  cryptoKey?: CryptoKey | null;
  parentNote?: Note;
}

function formatCreated(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(dateString));
}

export const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onOpen,
  onDelete,
  onUpdateSchedule,
  onEditSchedule,
  cryptoKey,
  parentNote,
}) => {
  const decryptedHtml = useDecryptedHtml(note.content || '', cryptoKey);
  const isTask = isTaskNote(note);
  const isDone = isTask && note.status === 'done';
  const progress = checklistProgress(note.content || '');
  const edited = Boolean(note.updated_at && note.updated_at !== note.created_at);
  const repeatLabel = note.recurrence_rule ? `Repeats: ${describeRecurrence(note)}. Edit` : 'Set repeat';

  return (
    <article
      className={`${styles.card} ${isDone ? styles.done : ''}`}
      onClick={() => onOpen(note)}
      tabIndex={0}
      aria-label={`Note: ${note.title || 'Untitled'}`}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen(note);
        }
      }}
    >
      <div className={styles.body}>
        <div className={styles.top}>
          <div className={styles.chips}>
            {note.canvas_name && <span className={`${ui.chip} ${ui.chipCanvas}`}>{note.canvas_name}</span>}
            {parentNote && (
              <button
                type="button"
                className={ui.chip}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(parentNote);
                }}
                title={`Part of ${parentNote.title || 'Untitled'}`}
              >
                <CornerDownRight size={12} />
                <span className={ui.chipLabel}>{parentNote.title || 'Untitled'}</span>
              </button>
            )}
            {isTask && (
              <StatusPill
                status={note.status}
                label={note.title}
                onChange={
                  onUpdateSchedule
                    ? (next) => onUpdateSchedule(note.id, note.scheduled_date, note.scheduled_time, next)
                    : undefined
                }
              />
            )}
          </div>
          <div className={styles.tools}>
            {note.scheduled_date && onEditSchedule && (
              <button
                type="button"
                className={`${ui.iconBtn} ${ui.iconSm} ${note.recurrence_rule ? ui.on : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onEditSchedule(note);
                }}
                title={repeatLabel}
                aria-label={repeatLabel}
              >
                <Repeat size={14} />
              </button>
            )}
            {onUpdateSchedule && (
              <DateChip
                date={note.scheduled_date}
                text={formatNoteDate(note)}
                onChange={(date) => onUpdateSchedule(note.id, date, date ? note.scheduled_time : null, note.status || 'todo')}
              />
            )}
          </div>
        </div>

        <h3 className={styles.title}>{note.title || 'Untitled'}</h3>
        <div className={styles.rich} dangerouslySetInnerHTML={{ __html: decryptedHtml }} />
      </div>

      <footer className={styles.foot}>
        <span className="tnum">
          {formatCreated(note.created_at)}
          {edited ? ' · Edited' : ''}
        </span>
        {progress && (
          <span className={`${styles.progress} tnum`} title="Checklist progress">
            <span className={styles.bar}>
              <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </span>
            {progress.done}/{progress.total}
          </span>
        )}
        <span className={styles.actions}>
          <button
            type="button"
            className={`${ui.iconBtn} ${ui.iconSm}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(note);
            }}
            title="Edit note"
            aria-label="Edit note"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className={`${ui.iconBtn} ${ui.iconSm} ${ui.iconDanger}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(note.id);
            }}
            title="Delete note"
            aria-label="Delete note"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </footer>
    </article>
  );
};
