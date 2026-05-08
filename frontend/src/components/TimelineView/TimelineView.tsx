import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { Note } from '../NoteCard/NoteCard';
import { DayView } from './DayView';
import type { TimelineTask } from './TimelineTaskCard';
import { WeekView } from './WeekView';
import styles from './TimelineView.module.css';

type SubView = 'day' | 'week';

interface TimelineViewProps {
  onOpenNote: (note: Note) => void;
  notes: Note[];
  fetchNotes: () => void;
}

function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart(date: Date): Date {
  const nextDate = new Date(date);
  const day = nextDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  nextDate.setDate(nextDate.getDate() + diff);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function getWeekEnd(weekStart: Date): Date {
  const nextDate = new Date(weekStart);
  nextDate.setDate(nextDate.getDate() + 6);
  return nextDate;
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

  const weekStart = getWeekStart(date);
  const weekEnd = getWeekEnd(weekStart);
  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = weekEnd.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} - ${endStr}`;
}

export const TimelineView: React.FC<TimelineViewProps> = ({ onOpenNote, notes, fetchNotes }) => {
  const [subView, setSubView] = useState<SubView>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [tasksByDate, setTasksByDate] = useState<Record<string, TimelineTask[]>>({});
  const [loading, setLoading] = useState(false);

  const getDateRange = useCallback((): { start: string; end: string } => {
    if (subView === 'day') {
      const dateStr = toISODateString(selectedDate);
      return { start: dateStr, end: dateStr };
    }

    const weekStart = getWeekStart(selectedDate);
    const weekEnd = getWeekEnd(weekStart);
    return { start: toISODateString(weekStart), end: toISODateString(weekEnd) };
  }, [subView, selectedDate]);

  const fetchTimeline = useCallback(async () => {
    const { start, end } = getDateRange();
    setLoading(true);

    try {
      const response = await apiFetch(`/api/timeline/?start_date=${start}&end_date=${end}`);
      if (response.ok) {
        const data: Record<string, TimelineTask[]> = await response.json();
        setTasksByDate(data);
      }
    } catch (error) {
      console.error('Failed to fetch timeline:', error);
    } finally {
      setLoading(false);
    }
  }, [getDateRange]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  useEffect(() => {
    setTasksByDate((prev) => {
      let changed = false;
      const updated = { ...prev };

      for (const dateKey of Object.keys(updated)) {
        updated[dateKey] = updated[dateKey].map((task) => {
          const globalNote = notes.find((note) => note.id === task.note.id);
          if (globalNote && (globalNote.title !== task.note.title || globalNote.content !== task.note.content)) {
            changed = true;
            return {
              ...task,
              note: {
                ...task.note,
                title: globalNote.title,
                content: globalNote.content,
              },
            };
          }
          return task;
        });
      }

      return changed ? updated : prev;
    });
  }, [notes]);

  const goToToday = () => setSelectedDate(new Date());

  const goPrev = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() - (subView === 'day' ? 1 : 7));
    setSelectedDate(nextDate);
  };

  const goNext = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + (subView === 'day' ? 1 : 7));
    setSelectedDate(nextDate);
  };

  const handleStatusChange = async (taskId: string, newStatus: string, occurrenceId?: string | null) => {
    setTasksByDate((prev) => {
      const updated = { ...prev };
      for (const dateKey of Object.keys(updated)) {
        updated[dateKey] = updated[dateKey].map((task) =>
          (occurrenceId ? task.occurrence_id === occurrenceId : task.id === taskId)
            ? { ...task, status: newStatus }
            : task,
        );
      }
      return updated;
    });

    try {
      if (occurrenceId) {
        await apiFetch(`/api/occurrences/${occurrenceId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: newStatus }),
        });
      } else {
        await apiFetch(`/api/notes/${taskId}/schedule`, {
          method: 'PUT',
          body: JSON.stringify({ status: newStatus }),
        });
      }
      fetchNotes();
    } catch (error) {
      console.error('Failed to update status:', error);
      fetchTimeline();
    }
  };

  const handleSkip = async (occurrenceId: string) => {
    setTasksByDate((prev) => {
      const updated = { ...prev };
      for (const dateKey of Object.keys(updated)) {
        updated[dateKey] = updated[dateKey].filter((task) => task.occurrence_id !== occurrenceId);
        if (updated[dateKey].length === 0) {
          delete updated[dateKey];
        }
      }
      return updated;
    });

    try {
      await apiFetch(`/api/occurrences/${occurrenceId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'todo', skipped: true }),
      });
      fetchNotes();
    } catch (error) {
      console.error('Failed to skip occurrence:', error);
      fetchTimeline();
    }
  };

  const dayTasks = tasksByDate[toISODateString(selectedDate)] || [];

  return (
    <div className={styles.container}>
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
                onChange={(event) => {
                  if (event.target.value) {
                    const [year, month, day] = event.target.value.split('-');
                    setSelectedDate(new Date(Number(year), Number(month) - 1, Number(day)));
                  }
                }}
                onClick={(event) => {
                  try {
                    if ('showPicker' in HTMLInputElement.prototype) {
                      (event.target as HTMLInputElement).showPicker();
                    }
                  } catch {
                    return;
                  }
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

      <div className={styles.content}>
        {loading ? (
          <div className={styles.emptyState}>Loading...</div>
        ) : subView === 'day' ? (
          <DayView
            date={selectedDate}
            tasks={dayTasks}
            onOpenNote={onOpenNote}
            onStatusChange={handleStatusChange}
            onSkip={handleSkip}
          />
        ) : (
          <WeekView
            weekStart={getWeekStart(selectedDate)}
            tasksByDate={tasksByDate}
            onOpenNote={onOpenNote}
            onStatusChange={handleStatusChange}
            onSkip={handleSkip}
          />
        )}
      </div>
    </div>
  );
};
