import React, { useRef } from 'react';
import styles from './NoteCard.module.css';
import { Calendar } from 'lucide-react';

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  scheduled_date: string | null;
  status: string;
}

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onView: (note: Note) => void;
  onUpdateSchedule?: (noteId: string, date: string | null, status: string) => void;
}

const STATUS_CYCLE: Record<string, string> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export const NoteCard: React.FC<NoteCardProps> = ({ note, onEdit, onDelete, onView, onUpdateSchedule }) => {
  const dateInputRef = useRef<HTMLInputElement>(null);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const formatScheduledDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentStatus = note.status || 'todo';
    const nextStatus = STATUS_CYCLE[currentStatus] || 'todo';
    onUpdateSchedule?.(note.id, note.scheduled_date, nextStatus);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newDate = e.target.value || null;
    onUpdateSchedule?.(note.id, newDate, note.status || 'todo');
  };

  const handleCalendarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dateInputRef.current?.showPicker();
  };

  return (
    <div className={styles.card} onClick={() => onView(note)}>
      <div className={styles.metaHeader}>
        <div className={styles.headerLeft}>
          <button 
            className={`${styles.statusPill} ${styles[`status_${note.status || 'todo'}`]}`}
            onClick={handleStatusClick}
            title={`Status: ${STATUS_LABELS[note.status || 'todo']} (click to cycle)`}
          >
            <span className={styles.statusPillDot} />
            {STATUS_LABELS[note.status || 'todo']}
          </button>
        </div>

        <div className={styles.headerRight}>
          <div className={styles.scheduleRow}>
            {note.scheduled_date && (
              <span className={styles.scheduledDate} onClick={handleCalendarClick}>
                📅 {formatScheduledDate(note.scheduled_date)}
              </span>
            )}
            <button
              className={styles.calendarBtn}
              onClick={handleCalendarClick}
              title="Set / Change date"
            >
              <Calendar size={14} />
              <input
                ref={dateInputRef}
                type="date"
                className={styles.hiddenDateInput}
                value={note.scheduled_date || ''}
                onChange={handleDateChange}
                onClick={(e) => e.stopPropagation()}
              />
            </button>
          </div>
        </div>
      </div>

      <h3 className={styles.title}>{note.title || 'Untitled'}</h3>
      <div 
        className={styles.description}
        dangerouslySetInnerHTML={{ __html: note.content }}
      />
      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          <span>{formatDate(note.created_at)}</span>
          {note.updated_at && note.updated_at !== note.created_at && (
            <span className={styles.editedTag} title="Edited">· Edited</span>
          )}
        </div>

        <div className={styles.actions}>
          <button 
            className={styles.actionBtn} 
            onClick={(e) => {
              e.stopPropagation();
              onEdit(note);
            }}
            title="Edit"
          >
            ✎
          </button>
          <button 
            className={`${styles.actionBtn} ${styles.deleteBtn}`} 
            onClick={(e) => {
              e.stopPropagation();
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
