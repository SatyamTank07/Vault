import React, { useRef } from 'react';
import { toIsoDate } from '../../lib/noteText';
import ui from '../ui/ui.module.css';
import { AgendaRows, OngoingRow, type AgendaHandlers } from './Agenda';
import { DateRibbon } from './DateRibbon';
import type { TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

interface DayViewProps extends AgendaHandlers {
  date: Date;
  tasks: TimelineTask[];
  tasksByDate?: Record<string, TimelineTask[]>;
  onSelectDate: (date: Date) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
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
  ...handlers
}) => {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const isToday = toIsoDate(date) === toIsoDate(new Date());
  const spans = tasks.filter((t) => t.is_span);
  const dayTasks = tasks.filter((t) => !t.is_span);

  // Swiping the agenda sideways moves a day.
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
      if (diffX < 0) onNextDay();
      else onPrevDay();
    }
  };

  return (
    <div className={styles.dayWrap}>
      <DateRibbon
        selectedDate={date}
        onSelectDate={onSelectDate}
        tasksByDate={tasksByDate}
        onPrevWeek={onPrevWeek}
        onNextWeek={onNextWeek}
      />

      <div className={styles.dayTitle}>
        <h2>
          {date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {isToday && <span className={ui.todayTag}>Today</span>}
        </h2>
        <span className={`${styles.count} tnum`}>
          <span>
            <b>{dayTasks.length}</b> task{dayTasks.length === 1 ? '' : 's'}
          </span>
          {spans.length > 0 && (
            <span>
              <b>{spans.length}</b> ongoing
            </span>
          )}
        </span>
      </div>

      <div className={styles.daySwipe} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {tasks.length > 0 ? (
          <div className={styles.ag}>
            <OngoingRow spans={spans} {...handlers} />
            <AgendaRows tasks={dayTasks} isToday={isToday} {...handlers} />
          </div>
        ) : (
          <div className={ui.empty}>
            <strong>Nothing scheduled</strong>
            Use New note to add something to this day.
          </div>
        )}
      </div>
    </div>
  );
};
