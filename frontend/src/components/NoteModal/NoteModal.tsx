import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, Repeat, X, Clock, ArrowRight } from 'lucide-react';
import styles from './NoteModal.module.css';
import type { Note } from '../NoteCard/NoteCard';
import { TipTapEditor } from '../TipTapEditor/TipTapEditor';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: Omit<Note, 'created_at' | 'updated_at' | 'status'>) => void;
  initialData?: Note | null;
  isViewMode?: boolean;
  cryptoKey?: CryptoKey | null;
}

function getTodayString(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTomorrowString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatSchedulePill({
  date,
  time,
  endDate,
  rule,
  interval,
}: {
  date: string;
  time: string | null;
  endDate: string | null;
  rule: string | null;
  interval: number;
}): string {
  const [sYear, sMonth, sDay] = date.split('-').map(Number);
  const startDateObj = new Date(sYear, sMonth - 1, sDay);
  const currentYear = new Date().getFullYear();
  const showYear = sYear !== currentYear;

  const formattedStart = startDateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });

  let datePart = formattedStart;
  if (endDate && endDate !== date) {
    const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
    const endDateObj = new Date(eYear, eMonth - 1, eDay);
    const formattedEnd = endDateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(eYear !== currentYear ? { year: 'numeric' } : {}),
    });
    datePart = `${formattedStart} – ${formattedEnd}`;
  }

  let timePart = '';
  if (time) {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    timePart = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
  }

  let recPart = '';
  if (rule) {
    if (rule === 'daily') {
      recPart = interval > 1 ? `Every ${interval} days` : 'Daily';
    } else if (rule === 'weekly') {
      recPart = interval > 1 ? `Every ${interval} weeks` : 'Weekly';
    } else if (rule === 'monthly') {
      recPart = interval > 1 ? `Every ${interval} months` : 'Monthly';
    }
  }

  const parts = [datePart];
  if (timePart) parts.push(timePart);
  if (recPart) parts.push(recPart);

  return parts.join(' · ');
}

export const NoteModal: React.FC<NoteModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  cryptoKey,
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);

  const popoverAnchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Generate a temporary ID for new notes to use as a folder name
  const [generatedId, setGeneratedId] = useState(() => crypto.randomUUID());
  const currentNoteId = initialData?.id || generatedId;

  const todayStr = getTodayString();
  const tomorrowStr = getTomorrowString();

  useEffect(() => {
    if (isOpen) {
      if (!initialData?.id) {
        setGeneratedId(crypto.randomUUID());
      }
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
      setScheduledDate(initialData?.scheduled_date || null);
      setScheduledTime(initialData?.scheduled_time || null);
      setEndDate(initialData?.end_date || null);
      setRecurrenceRule(initialData?.recurrence_rule || null);
      setRecurrenceInterval(initialData?.recurrence_interval || 1);
      setRecurrenceEndDate(initialData?.recurrence_end_date || null);
      setIsPopoverOpen(false);
      setShowConfirmDiscard(false);
    }
  }, [isOpen, initialData]);

  // Check if current form values differ from initial values
  const hasUnsavedChanges = useMemo(() => {
    const normalizeContent = (html: string) => {
      return html
        .replace(/<p>\s*<\/p>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    };

    const initialTitle = (initialData?.title || '').trim();
    const currentTitle = title.trim();
    if (currentTitle !== initialTitle) return true;

    const initialNormalized = normalizeContent(initialData?.content || '');
    const currentNormalized = normalizeContent(content || '');
    if (currentNormalized !== initialNormalized) return true;

    const initialScheduledDate = initialData?.scheduled_date || null;
    if ((scheduledDate || null) !== initialScheduledDate) return true;

    const initialScheduledTime = initialData?.scheduled_time || null;
    if ((scheduledTime || null) !== initialScheduledTime) return true;

    const initialEndDate = initialData?.end_date || null;
    if ((endDate || null) !== initialEndDate) return true;

    const initialRecurrenceRule = initialData?.recurrence_rule || null;
    if ((recurrenceRule || null) !== initialRecurrenceRule) return true;

    const initialRecurrenceInterval = initialData?.recurrence_interval || 1;
    if ((recurrenceInterval || 1) !== initialRecurrenceInterval) return true;

    const initialRecurrenceEndDate = initialData?.recurrence_end_date || null;
    if ((recurrenceEndDate || null) !== initialRecurrenceEndDate) return true;

    return false;
  }, [
    title,
    content,
    scheduledDate,
    scheduledTime,
    endDate,
    recurrenceRule,
    recurrenceInterval,
    recurrenceEndDate,
    initialData,
  ]);

  // Prevent browser reload/navigation when editing with unsaved changes
  useEffect(() => {
    if (!isOpen || !hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOpen, hasUnsavedChanges]);

  // Click-outside listener for the scheduling popover
  useEffect(() => {
    if (!isPopoverOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (backdropRef.current && backdropRef.current.contains(target)) {
        setIsPopoverOpen(false);
        return;
      }
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        popoverAnchorRef.current &&
        !popoverAnchorRef.current.contains(target)
      ) {
        setIsPopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isPopoverOpen]);

  // Escape key handler: dismiss popover first, then prompt if unsaved changes exist
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showConfirmDiscard) {
          setShowConfirmDiscard(false);
          return;
        }
        if (isPopoverOpen) {
          e.preventDefault();
          setIsPopoverOpen(false);
          return;
        }
        if (hasUnsavedChanges) {
          e.preventDefault();
          setShowConfirmDiscard(true);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasUnsavedChanges, isPopoverOpen, showConfirmDiscard, onClose]);

  const handleOverlayClick = () => {
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
      return;
    }
    if (hasUnsavedChanges) {
      setShowConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const handleCloseClick = () => {
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
    }
    if (hasUnsavedChanges) {
      setShowConfirmDiscard(true);
    } else {
      onClose();
    }
  };

  const handleCancelClick = () => {
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
    }
    if (hasUnsavedChanges) {
      setShowConfirmDiscard(true);
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowConfirmDiscard(false);
    setIsPopoverOpen(false);
    onClose();
  };

  const handleClearSchedule = () => {
    setScheduledDate(null);
    setScheduledTime(null);
    setEndDate(null);
    setRecurrenceRule(null);
    setRecurrenceInterval(1);
    setRecurrenceEndDate(null);
    setIsPopoverOpen(false);
  };

  const handleAddDateClick = () => {
    if (!scheduledDate) {
      setScheduledDate(todayStr);
    }
    setIsPopoverOpen((prev) => !prev);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
    }
    onSave({ 
      id: currentNoteId, 
      title, 
      content,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      end_date: endDate,
      recurrence_rule: recurrenceRule,
      recurrence_interval: recurrenceInterval,
      recurrence_end_date: recurrenceEndDate,
    });
    onClose();
  };

  const handleMobileDoneClick = (e: React.MouseEvent) => {
    const form = document.getElementById('note-modal-form') as HTMLFormElement | null;
    if (form && typeof form.requestSubmit === 'function') {
      e.preventDefault();
      form.requestSubmit();
    } else {
      handleSubmit(e);
    }
  };

  if (!isOpen) return null;

  const formattedSchedule = scheduledDate
    ? formatSchedulePill({
        date: scheduledDate,
        time: scheduledTime,
        endDate,
        rule: recurrenceRule,
        interval: recurrenceInterval,
      })
    : '';

  return (
    <>
      <div className={styles.overlay} onClick={handleOverlayClick}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          {/* Header & Mobile Sheet Navigation Bar */}
          <div className={styles.header}>
            <button
              type="button"
              className={styles.mobileCancelBtn}
              onClick={handleCancelClick}
            >
              Cancel
            </button>

            <div className={styles.headerCenter}>
              {initialData?.canvas_name ? (
                <span className={styles.categoryBadge} title={`In canvas: ${initialData.canvas_name}`}>
                  {initialData.canvas_name}
                </span>
              ) : (
                <span className={styles.viewIndicator}>
                  {initialData?.id ? 'Edit Note' : 'New Note'}
                </span>
              )}
            </div>

            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={handleCloseClick}
                aria-label="Close"
                title="Close"
              >
                <X size={18} />
              </button>
              <button
                type="button"
                className={styles.mobileSaveBtn}
                onClick={handleMobileDoneClick}
                disabled={!title.trim() && !content.trim()}
              >
                Done
              </button>
            </div>
          </div>

          <form id="note-modal-form" className={styles.form} onSubmit={handleSubmit}>
            {/* 2. Typography First: borderless title input directly above content */}
            <div className={styles.titleSection}>
              <input
                id="note-title"
                type="text"
                className={styles.titleInput}
                placeholder="Note title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus={!initialData?.title}
              />
            </div>

            {/* 3. Consolidated Scheduling Pill & Unified Popover */}
            <div className={styles.metadataStrip} ref={popoverAnchorRef}>
              {scheduledDate ? (
                <button
                  type="button"
                  className={`${styles.scheduledPill} ${isPopoverOpen ? styles.pillActive : ''}`}
                  onClick={() => setIsPopoverOpen((prev) => !prev)}
                  title="Edit schedule"
                >
                  <Calendar size={13} className={styles.pillIcon} />
                  <span>{formattedSchedule}</span>
                  {recurrenceRule && <Repeat size={12} className={styles.pillRecurrenceIcon} />}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.addDatePill} ${isPopoverOpen ? styles.pillActive : ''}`}
                  onClick={handleAddDateClick}
                  title="Add schedule"
                >
                  <Calendar size={13} className={styles.pillIcon} />
                  <span>+ Add date</span>
                </button>
              )}

              {isPopoverOpen && (
                <>
                  <div
                    ref={backdropRef}
                    className={styles.popoverBackdrop}
                    onClick={() => setIsPopoverOpen(false)}
                    aria-hidden="true"
                  />
                  <div className={styles.popover} ref={popoverRef}>
                    <div className={styles.dragHandle} aria-hidden="true" />
                    <div className={styles.popoverHeader}>
                    <div className={styles.popoverHeaderTitle}>
                      <Calendar size={14} className={styles.popoverIcon} />
                      <span>Schedule</span>
                    </div>
                    <button
                      type="button"
                      className={styles.popoverCloseBtn}
                      onClick={() => setIsPopoverOpen(false)}
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* Date section */}
                  <div className={styles.popoverSection}>
                    <div className={styles.presetRow}>
                      <button
                        type="button"
                        className={`${styles.presetBtn} ${scheduledDate === todayStr ? styles.presetBtnActive : ''}`}
                        onClick={() => {
                          setScheduledDate(todayStr);
                          if (endDate && todayStr > endDate) setEndDate(todayStr);
                        }}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className={`${styles.presetBtn} ${scheduledDate === tomorrowStr ? styles.presetBtnActive : ''}`}
                        onClick={() => {
                          setScheduledDate(tomorrowStr);
                          if (endDate && tomorrowStr > endDate) setEndDate(tomorrowStr);
                        }}
                      >
                        Tomorrow
                      </button>
                    </div>

                    <div className={styles.inputGroup}>
                      <label className={styles.popoverLabel}>Date</label>
                      <input
                        type="date"
                        className={styles.popoverInput}
                        value={scheduledDate || ''}
                        onChange={(e) => {
                          const newDate = e.target.value || null;
                          setScheduledDate(newDate);
                          if (!newDate) {
                            setScheduledTime(null);
                            setEndDate(null);
                            setRecurrenceRule(null);
                            setRecurrenceEndDate(null);
                          } else if (endDate && newDate > endDate) {
                            setEndDate(newDate);
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Time section */}
                  {scheduledDate && (
                    <div className={styles.popoverSection}>
                      <div className={styles.sectionHeader}>
                        <label className={styles.popoverLabel}>Time</label>
                        {scheduledTime !== null && (
                          <button
                            type="button"
                            className={styles.removeOptionBtn}
                            onClick={() => setScheduledTime(null)}
                            title="Remove time"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      {scheduledTime !== null ? (
                        <div className={styles.timeInputWrapper}>
                          <Clock size={14} className={styles.inputIcon} />
                          <input
                            type="time"
                            className={styles.popoverInput}
                            value={scheduledTime || ''}
                            onChange={(e) => setScheduledTime(e.target.value || null)}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.popoverAddOptionBtn}
                          onClick={() => setScheduledTime('09:00')}
                        >
                          + Add time
                        </button>
                      )}
                    </div>
                  )}

                  {/* Multi-day section */}
                  {scheduledDate && (
                    <div className={styles.popoverSection}>
                      <div className={styles.sectionHeader}>
                        <label className={styles.popoverLabel}>End Date (Multi-day)</label>
                        {endDate !== null && (
                          <button
                            type="button"
                            className={styles.removeOptionBtn}
                            onClick={() => setEndDate(null)}
                            title="Remove end date"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      {endDate !== null ? (
                        <div className={styles.endDateWrapper}>
                          <ArrowRight size={14} className={styles.inputIcon} />
                          <input
                            type="date"
                            className={styles.popoverInput}
                            value={endDate || ''}
                            min={scheduledDate}
                            onChange={(e) => setEndDate(e.target.value || null)}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.popoverAddOptionBtn}
                          onClick={() => setEndDate(scheduledDate)}
                        >
                          + Multi-day
                        </button>
                      )}
                    </div>
                  )}

                  {/* Recurrence section */}
                  {scheduledDate && (
                    <div className={styles.popoverSection}>
                      <div className={styles.sectionHeader}>
                        <label className={styles.popoverLabel}>Recurrence</label>
                        {recurrenceRule && (
                          <button
                            type="button"
                            className={styles.removeOptionBtn}
                            onClick={() => {
                              setRecurrenceRule(null);
                              setRecurrenceInterval(1);
                              setRecurrenceEndDate(null);
                            }}
                            title="Remove recurrence"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <select
                        className={styles.popoverSelect}
                        value={recurrenceRule || ''}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setRecurrenceRule(val);
                          if (!val) {
                            setRecurrenceInterval(1);
                            setRecurrenceEndDate(null);
                          }
                        }}
                      >
                        <option value="">Does not repeat</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>

                      {recurrenceRule && (
                        <div className={styles.recurrenceDetails}>
                          <div className={styles.intervalRow}>
                            <span className={styles.subLabel}>Every</span>
                            <input
                              type="number"
                              className={styles.intervalInput}
                              value={recurrenceInterval}
                              min={1}
                              max={99}
                              onChange={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                            <span className={styles.intervalUnit}>
                              {recurrenceRule === 'daily'
                                ? recurrenceInterval === 1
                                  ? 'day'
                                  : 'days'
                                : recurrenceRule === 'weekly'
                                ? recurrenceInterval === 1
                                  ? 'week'
                                  : 'weeks'
                                : recurrenceInterval === 1
                                ? 'month'
                                : 'months'}
                            </span>
                          </div>

                          <div className={styles.repeatUntilSection}>
                            <span className={styles.subLabel}>Ends</span>
                            <div className={styles.endTypeToggle}>
                              <button
                                type="button"
                                className={`${styles.togglePill} ${!recurrenceEndDate ? styles.togglePillActive : ''}`}
                                onClick={() => setRecurrenceEndDate(null)}
                              >
                                Forever
                              </button>
                              <button
                                type="button"
                                className={`${styles.togglePill} ${recurrenceEndDate ? styles.togglePillActive : ''}`}
                                onClick={() => {
                                  if (!recurrenceEndDate) {
                                    setRecurrenceEndDate(endDate || scheduledDate || todayStr);
                                  }
                                }}
                              >
                                On date
                              </button>
                            </div>

                            {recurrenceEndDate && (
                              <input
                                type="date"
                                className={styles.popoverInput}
                                value={recurrenceEndDate}
                                min={scheduledDate}
                                onChange={(e) => setRecurrenceEndDate(e.target.value || null)}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Popover footer */}
                  <div className={styles.popoverFooter}>
                    {scheduledDate && (
                      <button
                        type="button"
                        className={styles.popoverClearAllBtn}
                        onClick={handleClearSchedule}
                      >
                        Clear schedule
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.popoverDoneBtn}
                      onClick={() => setIsPopoverOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </>
            )}
            </div>

            <div className={styles.contentGroup}>
              <TipTapEditor 
                content={content} 
                onChange={setContent} 
                noteId={currentNoteId} 
                readOnly={false} 
                cryptoKey={cryptoKey}
              />
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.cancelBtn} onClick={handleCancelClick}>
                {hasUnsavedChanges ? 'Cancel' : 'Close'}
              </button>
              <button type="submit" className={styles.saveBtn}>
                Save Note
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirmDiscard}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes in this note. Are you sure you want to discard them and exit?"
        confirmText="Discard Changes"
        cancelText="Keep Editing"
        isDestructive={true}
        onConfirm={handleConfirmDiscard}
        onCancel={() => setShowConfirmDiscard(false)}
      />
    </>
  );
};
