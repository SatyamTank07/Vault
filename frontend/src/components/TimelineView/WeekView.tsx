import React, { useMemo } from 'react';
import { Check, Layers } from 'lucide-react';
import { toIsoDate } from '../../lib/noteText';
import ui from '../ui/ui.module.css';
import { AgendaRows, OngoingRow, type AgendaHandlers } from './Agenda';
import { SpanRibbon, TaskRow, type TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

interface WeekViewProps extends AgendaHandlers {
  weekStart: Date; // Monday of the week
  tasksByDate: Record<string, TimelineTask[]>;
  layout?: 'horizontal' | 'vertical';
}

export const WeekView: React.FC<WeekViewProps> = ({ weekStart, tasksByDate, layout = 'horizontal', ...handlers }) => {
  const todayKey = toIsoDate(new Date());
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart],
  );
  const keys = days.map(toIsoDate);

  // Multi-day notes active this week, once each.
  const spans = useMemo(() => {
    const byNote = new Map<string, TimelineTask>();
    Object.values(tasksByDate).forEach((list) => list.forEach((t) => t.is_span && byNote.set(t.note.id, t)));
    return [...byNote.values()];
  }, [tasksByDate]);

  // A day's tasks in time order; all-day tasks after timed ones, as in the agenda.
  const dayTasks = (key: string) =>
    (tasksByDate[key] || [])
      .filter((t) => !t.is_span)
      .sort((a, b) => (a.scheduled_time || '99').localeCompare(b.scheduled_time || '99'));

  if (layout === 'vertical') {
    const withTasks = days.filter((d) => dayTasks(toIsoDate(d)).length > 0);
    const taskCount = keys.reduce((sum, k) => sum + dayTasks(k).length, 0);
    const freeDays = days.length - withTasks.length;
    return (
      <div className={styles.dayWrap}>
        <div className={styles.dayTitle}>
          <h2>Week of {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</h2>
          <span className={`${styles.count} tnum`}>
            <span>
              <b>{taskCount}</b> task{taskCount === 1 ? '' : 's'}
            </span>
            {spans.length > 0 && (
              <span>
                <b>{spans.length}</b> ongoing
              </span>
            )}
          </span>
        </div>
        <div className={styles.wkList}>
          {spans.length > 0 && (
            <div className={styles.ag}>
              <OngoingRow spans={spans} {...handlers} />
            </div>
          )}
          {withTasks.map((d) => {
            const key = toIsoDate(d);
            const count = dayTasks(key).length;
            const isToday = key === todayKey;
            return (
              <section key={key} className={styles.ag}>
                <div className={`${styles.agRow} ${styles.wlHead} ${isToday ? styles.wlToday : ''}`}>
                  <div className={`${styles.agWhen} tnum`}>
                    <small>{d.toLocaleDateString('en-US', { weekday: 'short' })}</small>
                    {d.getDate()}
                  </div>
                  <div className={styles.wlTitle}>
                    <h3>{d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
                    {isToday && <span className={ui.todayTag}>Today</span>}
                    <span className={`${styles.wlCount} tnum`}>
                      {count} task{count === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <AgendaRows tasks={dayTasks(key)} isToday={isToday} {...handlers} />
              </section>
            );
          })}
          {withTasks.length === 0 ? (
            <div className={ui.empty}>
              <strong>No tasks this week</strong>
              Use New note to plan something.
            </div>
          ) : (
            freeDays > 0 && (
              <div className={styles.wlRest}>
                <Check size={13} />
                {freeDays} free day{freeDays === 1 ? '' : 's'} hidden
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // Columns: span ribbons sit on the same 7-column grid as the days below them.
  const spanColumns = (task: TimelineTask) => {
    const start = task.start_date || task.scheduled_date;
    const end = task.end_date || start;
    const first = Math.max(0, keys.findIndex((k) => k >= start));
    let last = 6;
    for (let i = 6; i >= 0; i--) {
      if (keys[i] <= end) {
        last = i;
        break;
      }
    }
    return `${first + 1} / ${last + 2}`;
  };

  return (
    <div className={styles.weekWrap}>
      {spans.length > 0 && (
        <div className={ui.sectionLabel}>
          <Layers size={13} />
          Active horizons · {spans.length}
        </div>
      )}
      <div className={styles.weekScroll}>
        {spans.length > 0 && (
          <div className={`${styles.weekGrid} ${styles.weekRibbons}`}>
            {spans.map((task) => (
              <SpanRibbon
                key={`ribbon-${task.note.id}`}
                task={task}
                style={{ gridColumn: spanColumns(task) }}
                onOpenNote={handlers.onOpenNote}
                onStatusChange={handlers.onStatusChange}
              />
            ))}
          </div>
        )}
        <div className={styles.weekGrid}>
          {days.map((d) => {
            const key = toIsoDate(d);
            const list = dayTasks(key);
            const isToday = key === todayKey;
            return (
              <section key={key} className={`${styles.dayCol} ${isToday ? styles.dayColToday : ''}`}>
                <div className={styles.dayHead}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  <b className="tnum">{d.getDate()}</b>
                  {isToday && <span className={ui.todayTag}>Today</span>}
                </div>
                <div className={styles.dayTasks}>
                  {list.length ? (
                    list.map((task) => (
                      <TaskRow
                        key={`${task.id}-${task.occurrence_id ?? ''}`}
                        task={task}
                        parentTitle={handlers.parentTitleOf(task.note.id)}
                        onOpenNote={handlers.onOpenNote}
                        onStatusChange={handlers.onStatusChange}
                        onSkip={handlers.onSkip}
                      />
                    ))
                  ) : (
                    <div className={styles.dayEmpty}>—</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
