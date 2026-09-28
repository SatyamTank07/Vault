import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Lock, Columns, List } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { decryptNote } from '../../lib/crypto';
import type { Note } from '../NoteCard/NoteCard';
import { DayView } from './DayView';
import type { TimelineTask } from './TimelineTaskCard';
import { WeekView } from './WeekView';
import { TimeStreamView } from '../TimeStreamView/TimeStreamView';
import styles from './TimelineView.module.css';

type SubView = 'day' | 'week' | 'horizon';

interface TimelineViewProps {
  onOpenNote: (note: Note) => void;
  notes: Note[];
  fetchNotes: () => void;
  cryptoKey: CryptoKey | null;
  showCompleted?: boolean;
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

function getRangeDays(z: number): number {
  if (z <= 0.25) return 14 + (z / 0.25) * (56 - 14);
  if (z <= 0.5) return 56 + ((z - 0.25) / 0.25) * (180 - 56);
  if (z <= 0.75) return 180 + ((z - 0.5) / 0.25) * (365 - 180);
  return 365 + ((z - 0.75) / 0.25) * (1095 - 365);
}

function getScaleFromZoom(z: number): 'day' | 'week' | 'month' | 'year' {
  if (z <= 0.25) return 'day';
  if (z <= 0.5) return 'week';
  if (z <= 0.75) return 'month';
  return 'year';
}

function formatDateLabel(date: Date, subView: SubView, zoomLevel: number): string {
  if (subView === 'day') {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  if (subView === 'week') {
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

  const rangeDays = getRangeDays(zoomLevel);
  const halfRangeMs = (rangeDays / 2) * 86400000;
  const viewportStart = new Date(date.getTime() - halfRangeMs);
  const viewportEnd = new Date(date.getTime() + halfRangeMs);
  const scale = getScaleFromZoom(zoomLevel);

  if (scale === 'day') {
    const startDay = viewportStart.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    const endDay = viewportEnd.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: viewportStart.getFullYear() === viewportEnd.getFullYear() ? undefined : 'numeric',
    });
    return `${startDay} – ${endDay}`;
  }

  if (scale === 'week') {
    const startMonth = viewportStart.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = viewportEnd.toLocaleDateString('en-US', { month: 'short' });
    const yearStr = viewportEnd.getFullYear();
    const monthStr = startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`;
    return `${monthStr} ${yearStr}`;
  }

  if (scale === 'month') {
    const startMonth = viewportStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const endMonth = viewportEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`;
  }

  const startYear = viewportStart.getFullYear();
  const endYear = viewportEnd.getFullYear();
  return startYear === endYear ? `${startYear}` : `${startYear} – ${endYear}`;
}

export const TimelineView: React.FC<TimelineViewProps> = ({ onOpenNote, notes, fetchNotes, cryptoKey, showCompleted = false }) => {
  // Default to day view on mobile screens (<= 600px), and week view on desktop
  const [subView, setSubView] = useState<SubView>(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 600) {
      return 'day';
    }
    return 'week';
  });
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [zoomLevel, setZoomLevel] = useState<number>(0.1);
  const [tasksByDate, setTasksByDate] = useState<Record<string, TimelineTask[]>>({});
  const [weekLayout, setWeekLayout] = useState<'horizontal' | 'vertical'>('horizontal');
  const [loading, setLoading] = useState(false);
  const lastFetchedRange = useRef<string>('');

  const zoomScale = getScaleFromZoom(zoomLevel);

  const getDateRange = useCallback((): { start: string; end: string } => {
    // For both 'day' and 'week' subviews, fetch the whole week range.
    // This gives the DateRibbon full task count dots and enables 0ms instant day switching.
    const weekStart = getWeekStart(selectedDate);
    const weekEnd = getWeekEnd(weekStart);
    return { start: toISODateString(weekStart), end: toISODateString(weekEnd) };
  }, [selectedDate]);

  const fetchTimeline = useCallback(async (force = false) => {
    const { start, end } = getDateRange();
    const rangeKey = `${start}_${end}`;
    if (!force && lastFetchedRange.current === rangeKey) {
      return;
    }
    setLoading(true);

    try {
      const response = await apiFetch(`/api/timeline/?start_date=${start}&end_date=${end}`);
      if (response.ok) {
        const data: Record<string, TimelineTask[]> = await response.json();

        // Decrypt note fields in timeline tasks
        if (cryptoKey) {
          for (const dateKey of Object.keys(data)) {
            for (let i = 0; i < data[dateKey].length; i++) {
              const task = data[dateKey][i];
              if (task.note) {
                const { note: decrypted } = await decryptNote(
                  task.note as unknown as Note,
                  cryptoKey,
                );
                data[dateKey][i] = {
                  ...task,
                  note: decrypted as unknown as typeof task.note,
                };
              }
            }
          }
        }

        setTasksByDate(data);
        lastFetchedRange.current = rangeKey;
      }
    } catch (error) {
      console.error('Failed to fetch timeline:', error);
    } finally {
      setLoading(false);
    }
  }, [getDateRange, cryptoKey]);

  useEffect(() => {
    if (subView !== 'horizon') {
      fetchTimeline();
    }
  }, [fetchTimeline, subView]);

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
    if (subView === 'day') {
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() - 1);
      setSelectedDate(nextDate);
    } else if (subView === 'week') {
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() - 7);
      setSelectedDate(nextDate);
    } else {
      const rangeDays = getRangeDays(zoomLevel);
      const halfRangeMs = (rangeDays / 2) * 86400000;
      const shiftMs = halfRangeMs * 0.75 * -1;
      setSelectedDate(new Date(selectedDate.getTime() + shiftMs));
    }
  };

  const goNext = () => {
    if (subView === 'day') {
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() + 1);
      setSelectedDate(nextDate);
    } else if (subView === 'week') {
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() + 7);
      setSelectedDate(nextDate);
    } else {
      const rangeDays = getRangeDays(zoomLevel);
      const halfRangeMs = (rangeDays / 2) * 86400000;
      const shiftMs = halfRangeMs * 0.75;
      setSelectedDate(new Date(selectedDate.getTime() + shiftMs));
    }
  };

  const goPrevWeek = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() - 7);
    setSelectedDate(nextDate);
  };

  const goNextWeek = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + 7);
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
      fetchTimeline(true);
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
      fetchTimeline(true);
    }
  };

  const filteredTasksByDate = Object.fromEntries(
    Object.entries(tasksByDate).map(([date, tasks]) => [
      date,
      showCompleted ? tasks : tasks.filter((t) => t.status !== 'done'),
    ])
  );

  const dayTasks = filteredTasksByDate[toISODateString(selectedDate)] || [];

  // Null-key guard
  if (!cryptoKey) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <Lock size={32} />
          <span>Vault locked</span>
        </div>
      </div>
    );
  }

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
            <span className={styles.dateLabel}>{formatDateLabel(selectedDate, subView, zoomLevel)}</span>
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

        <div className={styles.rightControls}>
          {subView === 'week' && (
            <div className={styles.viewToggle} title="Week Layout">
              <button
                className={`${styles.viewBtn} ${styles.iconBtn} ${weekLayout === 'horizontal' ? styles.viewBtnActive : ''}`}
                onClick={() => setWeekLayout('horizontal')}
                title="Horizontal Layout"
              >
                <Columns size={16} />
              </button>
              <button
                className={`${styles.viewBtn} ${styles.iconBtn} ${weekLayout === 'vertical' ? styles.viewBtnActive : ''}`}
                onClick={() => setWeekLayout('vertical')}
                title="Vertical Layout"
              >
                <List size={16} />
              </button>
            </div>
          )}

          {subView === 'horizon' && (
            <div className={styles.horizonZoomWrapper}>
              <div className={styles.zoomLabels}>
                <button
                  type="button"
                  className={`${styles.zoomLabelBtn} ${zoomScale === 'day' ? styles.zoomLabelBtnActive : ''}`}
                  onClick={() => setZoomLevel(0.1)}
                  title="Day Scale (14 Days)"
                >
                  Day
                </button>
                <button
                  type="button"
                  className={`${styles.zoomLabelBtn} ${zoomScale === 'week' ? styles.zoomLabelBtnActive : ''}`}
                  onClick={() => setZoomLevel(0.35)}
                  title="Week Scale (2 Months)"
                >
                  Week
                </button>
                <button
                  type="button"
                  className={`${styles.zoomLabelBtn} ${zoomScale === 'month' ? styles.zoomLabelBtnActive : ''}`}
                  onClick={() => setZoomLevel(0.6)}
                  title="Month Scale (6 Months)"
                >
                  Month
                </button>
                <button
                  type="button"
                  className={`${styles.zoomLabelBtn} ${zoomScale === 'year' ? styles.zoomLabelBtnActive : ''}`}
                  onClick={() => setZoomLevel(0.9)}
                  title="Year Scale (3 Years)"
                >
                  Year
                </button>
              </div>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.01" 
                value={zoomLevel} 
                onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                className={styles.zoomSlider}
                title="Zoom Level"
              />
            </div>
          )}

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
            <button
              className={`${styles.viewBtn} ${subView === 'horizon' ? styles.viewBtnActive : ''}`}
              onClick={() => setSubView('horizon')}
            >
              Horizon
            </button>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {subView === 'horizon' ? (
          <TimeStreamView
            centerDate={selectedDate}
            onCenterDateChange={setSelectedDate}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            hideControls={true}
            onOpenNote={onOpenNote}
            notes={notes}
            fetchNotes={fetchNotes}
            cryptoKey={cryptoKey}
            showCompleted={showCompleted}
          />
        ) : loading && Object.keys(tasksByDate).length === 0 ? (
          <div className={styles.emptyState}>Loading...</div>
        ) : subView === 'day' ? (
          <DayView
            date={selectedDate}
            tasks={dayTasks}
            tasksByDate={filteredTasksByDate}
            onSelectDate={setSelectedDate}
            onPrevDay={goPrev}
            onNextDay={goNext}
            onPrevWeek={goPrevWeek}
            onNextWeek={goNextWeek}
            onOpenNote={onOpenNote}
            onStatusChange={handleStatusChange}
            onSkip={handleSkip}
          />
        ) : (
          <WeekView
            weekStart={getWeekStart(selectedDate)}
            tasksByDate={filteredTasksByDate}
            layout={weekLayout}
            onOpenNote={onOpenNote}
            onStatusChange={handleStatusChange}
            onSkip={handleSkip}
          />
        )}
      </div>
    </div>
  );
};
