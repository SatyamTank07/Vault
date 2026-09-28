import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

export interface DateRibbonProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  tasksByDate?: Record<string, TimelineTask[]>;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
}

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

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

export const DateRibbon: React.FC<DateRibbonProps> = ({
  selectedDate,
  onSelectDate,
  tasksByDate = {},
  onPrevWeek,
  onNextWeek,
}) => {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const weekStart = getWeekStart(selectedDate);
  const today = new Date();

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

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

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX < 0) {
        if (onNextWeek) {
          onNextWeek();
        } else {
          const next = new Date(selectedDate);
          next.setDate(next.getDate() + 7);
          onSelectDate(next);
        }
      } else {
        if (onPrevWeek) {
          onPrevWeek();
        } else {
          const prev = new Date(selectedDate);
          prev.setDate(prev.getDate() - 7);
          onSelectDate(prev);
        }
      }
    }
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPrevWeek) {
      onPrevWeek();
    } else {
      const prev = new Date(selectedDate);
      prev.setDate(prev.getDate() - 7);
      onSelectDate(prev);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onNextWeek) {
      onNextWeek();
    } else {
      const next = new Date(selectedDate);
      next.setDate(next.getDate() + 7);
      onSelectDate(next);
    }
  };

  return (
    <div
      className={styles.dateRibbon}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="region"
      aria-label="7-Day Date Ribbon"
    >
      <button
        type="button"
        className={styles.ribbonNavBtn}
        onClick={handlePrev}
        title="Previous week"
        aria-label="Previous week"
      >
        <ChevronLeft size={16} />
      </button>

      <div className={styles.ribbonDays}>
        {days.map((day, idx) => {
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, today);
          const dateKey = toISODateString(day);
          const dayTasks = tasksByDate[dateKey] || [];
          const taskCount = dayTasks.length;
          const hasIncomplete = dayTasks.some((t) => t.status !== 'done');

          return (
            <button
              key={dateKey}
              type="button"
              className={`${styles.ribbonDayBtn} ${isSelected ? styles.ribbonDaySelected : ''} ${
                isToday ? styles.ribbonDayToday : ''
              }`}
              onClick={() => onSelectDate(day)}
              title={`${day.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })} — ${taskCount} task${taskCount !== 1 ? 's' : ''}`}
              aria-pressed={isSelected}
            >
              <span className={styles.ribbonDayLabel}>{DAY_INITIALS[idx]}</span>
              <span className={styles.ribbonDayNum}>{day.getDate()}</span>
              <span className={styles.ribbonDotContainer}>
                {taskCount > 0 ? (
                  <span
                    className={`${styles.ribbonDot} ${
                      !hasIncomplete ? styles.ribbonDotDone : ''
                    }`}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.ribbonNavBtn}
        onClick={handleNext}
        title="Next week"
        aria-label="Next week"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};
