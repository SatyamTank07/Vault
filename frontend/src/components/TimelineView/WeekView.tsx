import React, { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { TimelineTaskCard, type TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

interface WeekViewProps {
  weekStart: Date; // Monday of the week
  tasksByDate: Record<string, TimelineTask[]>;
  layout?: 'horizontal' | 'vertical';
  onOpenNote: (note: any) => void;
  onStatusChange: (taskId: string, newStatus: string, occurrenceId?: string | null) => void;
  onSkip?: (occurrenceId: string) => void;
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

function formatSpanRange(startStr?: string, endStr?: string): string {
  if (!startStr) return '';
  const s = new Date(startStr + 'T00:00:00');
  const sFormatted = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!endStr || endStr === startStr) return sFormatted;
  const e = new Date(endStr + 'T00:00:00');
  const eFormatted = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${sFormatted} – ${eFormatted}`;
}

export const WeekView: React.FC<WeekViewProps> = ({
  weekStart,
  tasksByDate,
  layout = 'horizontal',
  onOpenNote,
  onStatusChange,
  onSkip,
}) => {
  const today = new Date();
  const days: Date[] = useMemo(() => {
    const list: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      list.push(d);
    }
    return list;
  }, [weekStart]);

  const isVertical = layout === 'vertical';

  // Aggregate unique multi-day project spans active during this week
  const weekSpans = useMemo(() => {
    const map = new Map<string, TimelineTask>();
    Object.values(tasksByDate).forEach((taskList) => {
      taskList.forEach((t) => {
        if (t.is_span) {
          map.set(t.note.id, t);
        }
      });
    });
    return Array.from(map.values());
  }, [tasksByDate]);

  const getSpanCols = (task: TimelineTask) => {
    const spanStart = task.start_date || task.scheduled_date;
    const spanEnd = task.end_date || spanStart;

    let startIdx = 0;
    for (let i = 0; i < 7; i++) {
      if (toISODateString(days[i]) >= spanStart) {
        startIdx = i;
        break;
      }
    }

    let endIdx = 6;
    for (let i = 6; i >= 0; i--) {
      if (toISODateString(days[i]) <= spanEnd) {
        endIdx = i;
        break;
      }
    }

    if (spanStart < toISODateString(days[0])) startIdx = 0;
    if (spanEnd > toISODateString(days[6])) endIdx = 6;

    return {
      startCol: startIdx + 1,
      endCol: endIdx + 2,
    };
  };

  let hasAnyTasks = weekSpans.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Horizon Ribbon Track for Multi-Day Spans */}
      {weekSpans.length > 0 && (
        <div className={styles.weekHorizonRibbonContainer}>
          <div className={styles.horizonSectionHeader}>
            <Layers size={13} />
            <span>Active Horizons ({weekSpans.length})</span>
          </div>
          <div className={isVertical ? styles.horizonBannerList : styles.weekHorizonRibbonGrid}>
            {weekSpans.map((task) => {
              const { startCol, endCol } = getSpanCols(task);
              return (
                <div
                  key={`week-ribbon-${task.id}`}
                  className={styles.weekHorizonRibbon}
                  style={!isVertical ? { gridColumn: `${startCol} / ${endCol}` } : undefined}
                  onClick={() => onOpenNote(task.note)}
                  title={`${task.note.title} (${formatSpanRange(task.start_date, task.end_date)})`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <button
                      className={`${styles.taskStatusDot} ${styles[task.status] || styles.todo}`}
                      style={{ width: '8px', height: '8px', flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextStatus =
                          task.status === 'todo'
                            ? 'in_progress'
                            : task.status === 'in_progress'
                              ? 'done'
                              : 'todo';
                        onStatusChange(task.id, nextStatus, task.occurrence_id);
                      }}
                      title={`Status: ${task.status}`}
                    />
                    <span className={styles.weekHorizonRibbonTitle}>{task.note.title || 'Untitled'}</span>
                  </div>
                  <span className={styles.weekHorizonRibbonDates}>
                    {formatSpanRange(task.start_date, task.end_date)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week Columns / Daily Agenda */}
      <div className={`${styles.weekView} ${isVertical ? styles.weekViewVertical : ''}`}>
        {days.map((day, idx) => {
          const dateKey = toISODateString(day);
          const dayTasks = tasksByDate[dateKey] || [];
          // Multi-day spans are displayed in the unified ribbon above, keeping daily columns uncluttered
          const regularTasks = dayTasks.filter((t) => !t.is_span);
          const isToday = isSameDay(day, today);

          if (regularTasks.length > 0) {
            hasAnyTasks = true;
          }

          // In vertical layout, hide days that have no regular tasks
          if (isVertical && regularTasks.length === 0) {
            return null;
          }

          return (
            <div
              key={dateKey}
              className={`${isVertical ? styles.weekDayVertical : styles.weekDay} ${isToday ? styles.weekDayToday : ''}`}
            >
              <div className={styles.weekDayHeader}>
                {DAY_NAMES[idx]}
                <span className={styles.weekDayNumber}>{day.getDate()}</span>
              </div>
              <div className={styles.weekDayTasks}>
                {regularTasks.length === 0 ? (
                  <div className={styles.weekDayEmpty}>—</div>
                ) : (
                  regularTasks.map((task) => (
                    <TimelineTaskCard
                      key={task.id}
                      task={task}
                      compact={!isVertical}
                      onOpenNote={onOpenNote}
                      onStatusChange={onStatusChange}
                      onSkip={onSkip}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}

        {isVertical && !hasAnyTasks && (
          <div className={styles.emptyState}>
            <p>No tasks scheduled for this week.</p>
          </div>
        )}
      </div>
    </div>
  );
};
