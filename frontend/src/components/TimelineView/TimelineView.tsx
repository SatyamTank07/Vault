import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Lock, Columns2, List } from 'lucide-react';
import { enqueue, getView, useReplica } from '../../lib/replica';
import { buildTimeline } from '../../lib/schedule';
import { decryptNote } from '../../lib/crypto';
import type { Note } from '../NoteCard/NoteCard';
import { DayView } from './DayView';
import type { TimelineTask } from './TimelineTaskCard';
import { WeekView } from './WeekView';
import { TimeStreamView } from '../TimeStreamView/TimeStreamView';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Toolbar } from '../ui/Toolbar';
import ui from '../ui/ui.module.css';
import styles from './TimelineView.module.css';

type SubView = 'day' | 'week' | 'horizon';

export interface TimelineViewActions {
  /** The day the schedule is looking at (YYYY-MM-DD), used to date a new note. */
  getContextDate: () => string;
}

interface TimelineViewProps {
  actionsRef?: React.Ref<TimelineViewActions>;
  onOpenNote: (note: Note) => void;
  notes: Note[];
  cryptoKey: CryptoKey | null;
  showCompleted?: boolean;
  onCreateChild?: (parentId: string) => void;
  onSetParent?: (noteId: string, parentId: string | null) => void;
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

const SCALE_PRESETS: { value: 'day' | 'week' | 'month' | 'year'; label: string; zoom: number; title: string }[] = [
  { value: 'day', label: 'Day', zoom: 0.1, title: 'Day scale (about 3 weeks)' },
  { value: 'week', label: 'Week', zoom: 0.35, title: 'Week scale (about 3 months)' },
  { value: 'month', label: 'Month', zoom: 0.6, title: 'Month scale (about 9 months)' },
  { value: 'year', label: 'Year', zoom: 0.9, title: 'Year scale (about 2 years)' },
];

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
    return `${startStr} – ${endStr}`;
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

export const TimelineView: React.FC<TimelineViewProps> = ({
  actionsRef,
  onOpenNote,
  notes,
  cryptoKey,
  showCompleted = false,
  onCreateChild,
  onSetParent,
}) => {
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

  useImperativeHandle(actionsRef, () => ({ getContextDate: () => toISODateString(selectedDate) }), [selectedDate]);

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
      {
        const data = buildTimeline(getView(), start, end) as unknown as Record<string, TimelineTask[]>;

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

  // Any change to the local copy (new note, edit, status, sync) rebuilds the visible week; moving
  // between days of the same week reuses what is already loaded.
  const replica = useReplica();
  const lastReplica = useRef(replica);
  useEffect(() => {
    if (subView === 'horizon') return;
    const changed = lastReplica.current !== replica;
    lastReplica.current = replica;
    fetchTimeline(changed);
  }, [fetchTimeline, subView, replica]);

  const parentTitleOf = useCallback(
    (noteId: string) => {
      const parentId = notes.find((n) => n.id === noteId)?.parent_note_id;
      if (!parentId) return undefined;
      return notes.find((n) => n.id === parentId)?.title || 'Untitled';
    },
    [notes],
  );

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

  /** A repeat is stored per occurrence (by its start date); anything else on the note itself. */
  const sameEntry = (a: TimelineTask, b: TimelineTask) =>
    a.id === b.id && (!a.is_recurring || (a.start_date ?? a.scheduled_date) === (b.start_date ?? b.scheduled_date));

  const handleStatusChange = async (task: TimelineTask, newStatus: string) => {
    setTasksByDate((prev) => {
      const updated = { ...prev };
      for (const dateKey of Object.keys(updated)) {
        updated[dateKey] = updated[dateKey].map((t) => (sameEntry(t, task) ? { ...t, status: newStatus } : t));
      }
      return updated;
    });

    if (task.is_recurring) {
      await enqueue('set_occurrence', {
        note_id: task.id,
        occurrence_date: task.start_date ?? task.scheduled_date,
        status: newStatus,
      });
    } else {
      await enqueue('set_schedule', { id: task.id, status: newStatus });
    }
  };

  const handleSkip = async (task: TimelineTask) => {
    setTasksByDate((prev) => {
      const updated = { ...prev };
      for (const dateKey of Object.keys(updated)) {
        updated[dateKey] = updated[dateKey].filter((t) => !sameEntry(t, task));
        if (updated[dateKey].length === 0) {
          delete updated[dateKey];
        }
      }
      return updated;
    });

    await enqueue('set_occurrence', {
      note_id: task.id,
      occurrence_date: task.start_date ?? task.scheduled_date,
      status: 'todo',
      skipped: true,
    });
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
        <div className={ui.empty}>
          <Lock size={32} />
          <strong>Vault locked</strong>
        </div>
      </div>
    );
  }

  const handlers = { onOpenNote, onStatusChange: handleStatusChange, onSkip: handleSkip, parentTitleOf };

  return (
    <div className={styles.container}>
      <Toolbar
        left={
          <>
            <button type="button" className={ui.iconBtn} onClick={goPrev} aria-label="Previous">
              <ChevronLeft size={18} />
            </button>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.sm}`} onClick={goToToday}>
              Today
            </button>
            <button type="button" className={ui.iconBtn} onClick={goNext} aria-label="Next">
              <ChevronRight size={18} />
            </button>
            <label className={`${ui.tbTitle} ${styles.dateLabel}`}>
              <span className="tnum">{formatDateLabel(selectedDate, subView, zoomLevel)}</span>
              <Calendar size={15} />
              <input
                type="date"
                aria-label="Jump to date"
                value={toISODateString(selectedDate)}
                onChange={(event) => {
                  if (event.target.value) {
                    const [year, month, day] = event.target.value.split('-');
                    setSelectedDate(new Date(Number(year), Number(month) - 1, Number(day)));
                  }
                }}
                onClick={(event) => {
                  try {
                    (event.target as HTMLInputElement).showPicker();
                  } catch {
                    // Older browsers open the picker from the input itself.
                  }
                }}
              />
            </label>
          </>
        }
        right={
          <>
            {subView === 'week' && (
              <SegmentedControl<'horizontal' | 'vertical'>
                size="sm"
                iconOnly
                ariaLabel="Week layout"
                value={weekLayout}
                onChange={setWeekLayout}
                options={[
                  { value: 'horizontal', icon: <Columns2 size={15} />, title: 'Columns' },
                  { value: 'vertical', icon: <List size={15} />, title: 'List' },
                ]}
              />
            )}
            {subView === 'horizon' && (
              <SegmentedControl
                size="sm"
                ariaLabel="Scale"
                value={zoomScale}
                onChange={(scale) => setZoomLevel(SCALE_PRESETS.find((p) => p.value === scale)?.zoom ?? 0.1)}
                options={SCALE_PRESETS.map(({ value, label, title }) => ({ value, label, title }))}
              />
            )}
            <SegmentedControl<SubView>
              size="sm"
              ariaLabel="Schedule view"
              value={subView}
              onChange={setSubView}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'horizon', label: 'Horizon' },
              ]}
            />
          </>
        }
      />

      <div className={subView === 'horizon' ? styles.contentFill : styles.content}>
        {subView === 'horizon' ? (
          <TimeStreamView
            centerDate={selectedDate}
            onCenterDateChange={setSelectedDate}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            onOpenNote={onOpenNote}
            notes={notes}
            cryptoKey={cryptoKey}
            showCompleted={showCompleted}
            onCreateChild={onCreateChild}
            onSetParent={onSetParent}
          />
        ) : loading && Object.keys(tasksByDate).length === 0 ? (
          <div className={ui.empty}>Loading…</div>
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
            {...handlers}
          />
        ) : (
          <WeekView
            weekStart={getWeekStart(selectedDate)}
            tasksByDate={filteredTasksByDate}
            layout={weekLayout}
            {...handlers}
          />
        )}
      </div>
    </div>
  );
};
