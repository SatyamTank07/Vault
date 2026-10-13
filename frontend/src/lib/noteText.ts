// Plain-text and date helpers shared by the grid, search, canvas and schedule views.
// Note text is only readable after decryption, so all of this runs client-side.

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export function normalizeStatus(status: string | null | undefined): TaskStatus {
  return status === 'in_progress' || status === 'done' ? status : 'todo';
}

interface ScheduleLike {
  status?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  end_date?: string | null;
}

/** A note behaves as a task once it has a status or a date. */
export function isTask(note: ScheduleLike): boolean {
  return (note.status !== null && note.status !== undefined) || Boolean(note.scheduled_date);
}

/** Strip tags and collapse whitespace, for search and previews. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Done/total for TipTap task-list items (`<li data-checked="true|false">`), or null if none. */
export function checklistProgress(html: string): { done: number; total: number } | null {
  const marks = html.match(/data-checked="(true|false)"/g);
  if (!marks || marks.length === 0) return null;
  return { done: marks.filter((m) => m.includes('true')).length, total: marks.length };
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Mar 4", with the year added when it isn't the current one. */
export function formatShortDate(iso: string): string {
  const date = parseIsoDate(iso);
  const showYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });
}

/** "9:30 AM" from "09:30" or "09:30:00". */
export function formatTime(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (Number.isNaN(h)) return time;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "Mar 4 – Mar 9" for a span, or a single date. */
export function formatDateRange(start: string, end?: string | null): string {
  if (!end || end === start) return formatShortDate(start);
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** The date text shown on chips: range, then time. Empty when the note has no date. */
export function formatNoteDate(note: ScheduleLike): string {
  if (!note.scheduled_date) return '';
  let text = formatDateRange(note.scheduled_date, note.end_date);
  if (note.scheduled_time) text += ` · ${formatTime(note.scheduled_time)}`;
  return text;
}

interface RecurrenceLike {
  recurrence_rule?: string | null;
  recurrence_interval?: number;
  recurrence_end_date?: string | null;
}

/** "Every 2 weeks until Mar 4", "Daily", ... */
export function describeRecurrence(note: RecurrenceLike): string {
  if (!note.recurrence_rule) return '';
  const rule = RECURRENCE_LABELS[note.recurrence_rule] || note.recurrence_rule;
  const interval = note.recurrence_interval || 1;
  const unit = note.recurrence_rule === 'daily' ? 'days' : note.recurrence_rule === 'weekly' ? 'weeks' : 'months';
  const frequency = interval === 1 ? rule : `Every ${interval} ${unit}`;
  return note.recurrence_end_date ? `${frequency} until ${formatShortDate(note.recurrence_end_date)}` : frequency;
}

/** Local YYYY-MM-DD for a Date (not UTC, so late-evening dates don't roll over). */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
