import React, { useRef } from 'react';
import { Clock, CalendarCheck2 } from 'lucide-react';
import { DateRibbon } from './DateRibbon';
import { TimelineTaskCard, type TimelineTask } from './TimelineTaskCard';
import type { Note } from '../NoteCard/NoteCard';
import styles from './TimelineView.module.css';

interface DayViewProps {
  date: Date;
  tasks: TimelineTask[];
  tasksByDate?: Record<string, TimelineTask[]>;
  onSelectDate?: (date: Date) => void;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  onOpenNote: (note: Note) => void;
  onStatusChange: (taskId: string, newStatus: string, occurrenceId?: string | null) => void;
  onSkip?: (occurrenceId: string) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatTimeSlot(timeStr: string): string {
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (isNaN(h)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  const minuteStr = m === 0 ? ':00' : `:${String(m).padStart(2, '0')}`;
  return `${hour12}${minuteStr} ${period}`;
}

export const DayView: React.FC<DayViewProps> = ({
  date,
  tasks,
  tasksByDate = {},
  onSelectDate,
  onPrevDay,
  onNextDay,
  onPrevWeek,
  onNextWeek,
  onOpenNote,
  onStatusChange,
  onSkip,
}) => {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const today = new Date();
  const isToday = isSameDay(date, today);

  // Split tasks into all-day and timed tasks
  const allDayTasks: TimelineTask[] = [];
  const timedTasks: TimelineTask[] = [];

  for (const task of tasks) {
    if (task.scheduled_time && task.scheduled_time.trim() !== '') {
      timedTasks.push(task);
    } else {
      allDayTasks.push(task);
    }
  }

  // Sort timed tasks chronologically
  timedTasks.sort((a, b) =>
    (a.scheduled_time || '').localeCompare(b.scheduled_time || '')
  );

  // Group timed tasks by scheduled time
  const timedGroups = timedTasks.reduce<Record<string, TimelineTask[]>>((acc, task) => {
    const timeKey = task.scheduled_time || '00:00';
    if (!acc[timeKey]) acc[timeKey] = [];
    acc[timeKey].push(task);
    return acc;
  }, {});

  const timeSlots = Object.keys(timedGroups).sort();

  // Handle swipe gestures on the agenda body to move between days
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartX.current;
    const diffY = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
      if (diffX < 0) {
        onNextDay?.();
      } else {
        onPrevDay?.();
      }
    }
  };

  return (
    <div className={styles.dayView}>
      {/* 7-Day Date Ribbon */}
      <DateRibbon
        selectedDate={date}
        onSelectDate={(newDate) => onSelectDate?.(newDate)}
        tasksByDate={tasksByDate}
        onPrevWeek={onPrevWeek}
        onNextWeek={onNextWeek}
      />

      {/* Day Header */}
      <div className={styles.dayHeader}>
        <div className={styles.dayHeaderTitleGroup}>
          <span className={styles.dayHeaderTitle}>{formatDayHeader(date)}</span>
          {isToday && <span className={styles.todayBadge}>Today</span>}
        </div>
        <span className={styles.dayHeaderSub}>
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Day Content / Hourly Agenda */}
      {tasks.length === 0 ? (
        <div
          className={styles.emptyState}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <CalendarCheck2 size={36} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>No tasks scheduled for this day</p>
          <p className={styles.emptyHint}>Swipe left or right to view other days</p>
        </div>
      ) : (
        <div
          className={styles.dayContent}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* All Day Section */}
          {allDayTasks.length > 0 && (
            <div className={styles.agendaSection}>
              <div className={styles.agendaSectionTitle}>
                <span>All Day ({allDayTasks.length})</span>
              </div>
              <div className={styles.taskList}>
                {allDayTasks.map((task) => (
                  <TimelineTaskCard
                    key={task.id}
                    task={task}
                    onOpenNote={onOpenNote}
                    onStatusChange={onStatusChange}
                    onSkip={onSkip}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Timed Hourly Agenda */}
          {timeSlots.length > 0 && (
            <div className={styles.agendaSection}>
              {allDayTasks.length > 0 && (
                <div className={styles.agendaSectionTitle}>
                  <span>Scheduled Agenda ({timedTasks.length})</span>
                </div>
              )}
              {timeSlots.map((timeKey) => (
                <div key={timeKey} className={styles.agendaTimeSlot}>
                  <div className={styles.agendaTimeHeader}>
                    <Clock size={12} />
                    <span>{formatTimeSlot(timeKey)}</span>
                  </div>
                  <div className={styles.taskList}>
                    {timedGroups[timeKey].map((task) => (
                      <TimelineTaskCard
                        key={task.id}
                        task={task}
                        onOpenNote={onOpenNote}
                        onStatusChange={onStatusChange}
                        onSkip={onSkip}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
