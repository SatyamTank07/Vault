import React from 'react';
import { Layers } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { formatTime } from '../../lib/noteText';
import { SpanRibbon, TaskRow, type StatusChangeHandler, type TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

export interface AgendaHandlers {
  onOpenNote: (note: Note) => void;
  onStatusChange: StatusChangeHandler;
  onSkip?: (task: TimelineTask) => void;
  parentTitleOf: (noteId: string) => string | undefined;
}

function nowHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** "Ongoing" row: multi-day notes as ribbons on the agenda rail. */
export const OngoingRow: React.FC<{ spans: TimelineTask[] } & AgendaHandlers> = ({ spans, onOpenNote, onStatusChange }) => {
  if (spans.length === 0) return null;
  return (
    <div className={styles.agRow}>
      <div className={styles.agWhen}>
        <Layers size={13} />
        <small>Ongoing</small>
      </div>
      <div className={styles.agItems}>
        {spans.map((task) => (
          <SpanRibbon key={`span-${task.note.id}-${task.start_date}`} task={task} onOpenNote={onOpenNote} onStatusChange={onStatusChange} />
        ))}
      </div>
    </div>
  );
};

/**
 * All-day row, then one row per time slot. On today, the first slot that still has an
 * unfinished task is marked "Up next".
 */
export const AgendaRows: React.FC<{ tasks: TimelineTask[]; isToday: boolean } & AgendaHandlers> = ({
  tasks,
  isToday,
  onOpenNote,
  onStatusChange,
  onSkip,
  parentTitleOf,
}) => {
  const allDay = tasks.filter((t) => !t.scheduled_time);
  const timed = tasks.filter((t) => t.scheduled_time);
  const slots = [...new Set(timed.map((t) => (t.scheduled_time as string).slice(0, 5)))].sort();
  const now = nowHHMM();
  const next = isToday
    ? slots.find((slot) => slot >= now && timed.some((t) => t.scheduled_time?.startsWith(slot) && t.status !== 'done'))
    : undefined;

  const row = (task: TimelineTask, hideTime: boolean) => (
    <TaskRow
      key={`${task.id}-${task.occurrence_id ?? ''}`}
      task={task}
      hideTime={hideTime}
      parentTitle={parentTitleOf(task.note.id)}
      onOpenNote={onOpenNote}
      onStatusChange={onStatusChange}
      onSkip={onSkip}
    />
  );

  return (
    <>
      {allDay.length > 0 && (
        <div className={styles.agRow}>
          <div className={styles.agWhen}>All day</div>
          <div className={styles.agItems}>{allDay.map((t) => row(t, false))}</div>
        </div>
      )}
      {slots.map((slot) => (
        <div key={slot} className={`${styles.agRow} ${slot === next ? styles.agNow : ''}`}>
          <div className={`${styles.agWhen} tnum`}>
            {formatTime(slot)}
            {slot === next && <small>Up next</small>}
          </div>
          <div className={styles.agItems}>
            {timed.filter((t) => t.scheduled_time?.startsWith(slot)).map((t) => row(t, true))}
          </div>
        </div>
      ))}
    </>
  );
};
