import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import type { TimelineTask } from './TimelineTaskCard';
import type { Note } from '../NoteCard/NoteCard';
import styles from './TimelineView.module.css';

const API_BASE_URL = 'http://localhost:8000';

type SubView = 'day' | 'week';

interface TimelineViewProps {
  onOpenNote: (note: Note) => void;
}

function toISODateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Get Monday of the week containing `date`. */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d;
}

function formatDateLabel(date: Date, subView: SubView): string {
  if (subView === 'day') {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
  // Week view — show range
  const weekStart = getWeekStart(date);
  const weekEnd = getWeekEnd(weekStart);
  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = weekEnd.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} – ${endStr}`;
}

export const TimelineView: React.FC<TimelineViewProps> = ({ onOpenNote }) => {
  const [subView, setSubView] = useState<SubView>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [tasksByDate, setTasksByDate] = useState<Record<string, TimelineTask[]>>({});
  const [loading, setLoading] = useState(false);

  // Compute the fetch range based on subView
  const getDateRange = useCallback((): { start: string; end: string } => {
    if (subView === 'day') {
      const dateStr = toISODateString(selectedDate);
      return { start: dateStr, end: dateStr };
    }
    const weekStart = getWeekStart(selectedDate);
    const weekEnd = getWeekEnd(weekStart);
    return { start: toISODateString(weekStart), end: toISODateString(weekEnd) };
  }, [subView, selectedDate]);

  // Fetch timeline data
  const fetchTimeline = useCallback(async () => {
    const { start, end } = getDateRange();
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/timeline/?start_date=${start}&end_date=${end}`
      );
      if (res.ok) {
        const data: Record<string, TimelineTask[]> = await res.json();
        setTasksByDate(data);
      }
    } catch (err) {
      console.error('Failed to fetch timeline:', err);
    } finally {
      setLoading(false);
    }
  }, [getDateRange]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  // Navigation
  const goToToday = () => setSelectedDate(new Date());

  const goPrev = () => {
    const d = new Date(selectedDate);
    if (subView === 'day') {
      d.setDate(d.getDate() - 1);
    } else {
      d.setDate(d.getDate() - 7);
    }
    setSelectedDate(d);
  };

  const goNext = () => {
    const d = new Date(selectedDate);
    if (subView === 'day') {
      d.setDate(d.getDate() + 1);
    } else {
      d.setDate(d.getDate() + 7);
    }
    setSelectedDate(d);
  };

  // Status change handler
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    // Optimistic update
    setTasksByDate((prev) => {
      const updated = { ...prev };
      for (const dateKey of Object.keys(updated)) {
        updated[dateKey] = updated[dateKey].map((t) =>
          t.id === taskId ? { ...t, status: newStatus } : t
        );
      }
      return updated;
    });

    try {
      await fetch(`${API_BASE_URL}/api/notes/${taskId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
      fetchTimeline(); // revert
    }
  };

  // Get tasks for the day view
  const dayTasks = tasksByDate[toISODateString(selectedDate)] || [];

  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.dateNav}>
          <button className={styles.navBtn} onClick={goPrev} title="Previous">
            <ChevronLeft size={18} />
          </button>
          <button className={styles.todayBtn} onClick={goToToday}>
            Today
          </button>
          <button className={styles.navBtn} onClick={goNext} title="Next">
            <ChevronRight size={18} />
          </button>
          <div className={styles.dateLabelContainer}>
            <span className={styles.dateLabel}>{formatDateLabel(selectedDate, subView)}</span>
            <div className={styles.datePickerBtn} title="Select Date">
              <Calendar size={16} />
              <input
                type="date"
                className={styles.datePickerHidden}
                value={toISODateString(selectedDate)}
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m, d] = e.target.value.split('-');
                    setSelectedDate(new Date(Number(y), Number(m) - 1, Number(d)));
                  }
                }}
                onClick={(e) => {
                  try {
                    if ('showPicker' in HTMLInputElement.prototype) {
                      (e.target as HTMLInputElement).showPicker();
                    }
                  } catch (err) {}
                }}
              />
            </div>
          </div>
        </div>

        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewBtn} ${subView === 'day' ? styles.viewBtnActive : ''}`}
            onClick={() => setSubView('day')}
          >
            Day
          </button>
          <button
            className={`${styles.viewBtn} ${subView === 'week' ? styles.viewBtnActive : ''}`}
            onClick={() => setSubView('week')}
          >
            Week
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {loading ? (
          <div className={styles.emptyState}>Loading...</div>
        ) : subView === 'day' ? (
          <DayView
            date={selectedDate}
            tasks={dayTasks}
            onOpenNote={onOpenNote}
            onStatusChange={handleStatusChange}
          />
        ) : (
          <WeekView
            weekStart={getWeekStart(selectedDate)}
            tasksByDate={tasksByDate}
            onOpenNote={onOpenNote}
            onStatusChange={handleStatusChange}
          />
        )}
      </div>
    </div>
  );
};
