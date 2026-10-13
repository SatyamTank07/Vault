import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toIsoDate } from '../../lib/noteText';
import ui from '../ui/ui.module.css';
import type { TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

export interface DateRibbonProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  tasksByDate?: Record<string, TimelineTask[]>;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The week as seven day buttons; dots show how many tasks a day has (up to three). */
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
  const todayKey = toIsoDate(new Date());
  const selectedKey = toIsoDate(selectedDate);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Swiping the ribbon sideways moves a week.
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
      if (diffX < 0) onNextWeek();
      else onPrevWeek();
    }
  };

  return (
    <div className={styles.dribbon} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button type="button" className={ui.iconBtn} onClick={onPrevWeek} aria-label="Previous week">
        <ChevronLeft size={16} />
      </button>
      <div className={styles.dribbonDays}>
        {days.map((day) => {
          const key = toIsoDate(day);
          const count = (tasksByDate[key] || []).filter((t) => !t.is_span).length;
          return (
            <button
              type="button"
              key={key}
              className={`${styles.dd} ${key === selectedKey ? styles.ddOn : ''} ${key === todayKey ? styles.ddToday : ''}`}
              onClick={() => onSelectDate(day)}
              aria-pressed={key === selectedKey}
              aria-label={`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} task${count === 1 ? '' : 's'}`}
            >
              {day.toLocaleDateString('en-US', { weekday: 'short' })}
              <b className="tnum">{day.getDate()}</b>
              <span className={styles.dots} aria-hidden="true">
                {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className={ui.iconBtn} onClick={onNextWeek} aria-label="Next week">
        <ChevronRight size={16} />
      </button>
    </div>
  );
};
