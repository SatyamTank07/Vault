import React from 'react';
import { TimelineTaskCard, type TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

interface WeekViewProps {
  weekStart: Date; // Monday of the week
  tasksByDate: Record<string, TimelineTask[]>;
  onOpenNote: (note: any) => void;
  onStatusChange: (taskId: string, newStatus: string) => void;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toISODateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const WeekView: React.FC<WeekViewProps> = ({
  weekStart,
  tasksByDate,
  onOpenNote,
  onStatusChange,
}) => {
  const today = new Date();
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  return (
    <div className={styles.weekView}>
      {days.map((day, idx) => {
        const dateKey = toISODateString(day);
        const dayTasks = tasksByDate[dateKey] || [];
        const isToday = isSameDay(day, today);

        return (
          <div
            key={dateKey}
            className={`${styles.weekDay} ${isToday ? styles.weekDayToday : ''}`}
          >
            <div className={styles.weekDayHeader}>
              {DAY_NAMES[idx]}
              <span className={styles.weekDayNumber}>{day.getDate()}</span>
            </div>
            <div className={styles.weekDayTasks}>
              {dayTasks.length === 0 ? (
                <div className={styles.weekDayEmpty}>—</div>
              ) : (
                dayTasks.map((task) => (
                  <TimelineTaskCard
                    key={task.id}
                    task={task}
                    compact
                    onOpenNote={onOpenNote}
                    onStatusChange={onStatusChange}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
