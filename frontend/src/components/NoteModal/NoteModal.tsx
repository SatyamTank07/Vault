import React, { useState, useEffect, useMemo } from 'react';
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
}

export const NoteModal: React.FC<NoteModalProps> = ({ isOpen, onClose, onSave, initialData, isViewMode = false }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(!isViewMode);

  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<'close' | 'view'>('close');
  
  // Generate a temporary ID for new notes to use as a folder name
  const generatedId = useMemo(() => crypto.randomUUID(), [isOpen, initialData]);
  const currentNoteId = initialData?.id || generatedId;

  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
      setScheduledDate(initialData?.scheduled_date || null);
      setScheduledTime(initialData?.scheduled_time || null);
      setEndDate(initialData?.end_date || null);
      setIsEditing(!isViewMode);
      setShowConfirmDiscard(false);
    }
  }, [isOpen, initialData, isViewMode]);

  // Check if current form values differ from initial values
  const hasUnsavedChanges = useMemo(() => {
    if (!isEditing) return false;

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

    return false;
  }, [isEditing, title, content, scheduledDate, scheduledTime, endDate, initialData]);

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

  // Escape key handler: prompt if unsaved changes exist
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showConfirmDiscard) {
          setShowConfirmDiscard(false);
          return;
        }
        if (isEditing && hasUnsavedChanges) {
          e.preventDefault();
          setDiscardTarget(isViewMode ? 'view' : 'close');
          setShowConfirmDiscard(true);
        } else if (isEditing && isViewMode) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isEditing, hasUnsavedChanges, isViewMode, showConfirmDiscard, onClose]);

  const handleOverlayClick = () => {
    if (isEditing && hasUnsavedChanges) {
      setDiscardTarget('close');
      setShowConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const handleCloseClick = () => {
    if (isEditing && hasUnsavedChanges) {
      setDiscardTarget('close');
      setShowConfirmDiscard(true);
    } else {
      onClose();
    }
  };

  const handleCancelClick = () => {
    if (isEditing) {
      if (hasUnsavedChanges) {
        setDiscardTarget(isViewMode ? 'view' : 'close');
        setShowConfirmDiscard(true);
      } else if (isViewMode) {
        setIsEditing(false);
      } else {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowConfirmDiscard(false);
    if (discardTarget === 'view' && isViewMode) {
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
      setScheduledDate(initialData?.scheduled_date || null);
      setScheduledTime(initialData?.scheduled_time || null);
      setEndDate(initialData?.end_date || null);
      setIsEditing(false);
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    onSave({ 
      id: currentNoteId, 
      title, 
      content,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      end_date: endDate,
    });
    
    if (isViewMode) {
      setIsEditing(false);
    } else {
      onClose();
    }
  };

  return (
    <>
      <div className={styles.overlay} onClick={handleOverlayClick}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleArea}>
            <h2>{isEditing ? (initialData ? 'Edit Note' : 'Create Note') : 'View Note'}</h2>
            
            <div className={styles.dateSection}>
              {isEditing ? (
                <div className={styles.editDateControls}>
                  <div className={styles.primaryDateWrapper}>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={scheduledDate || ''}
                      onChange={(e) => {
                        const newStart = e.target.value || null;
                        setScheduledDate(newStart);
                        if (!newStart) {
                          setScheduledTime(null);
                          setEndDate(null);
                        } else if (endDate && newStart > endDate) {
                          setEndDate(newStart);
                        }
                      }}
                      title="Schedule Date"
                    />
                    {scheduledDate && (
                      <button
                        type="button"
                        className={styles.clearDateBtn}
                        onClick={() => {
                          setScheduledDate(null);
                          setScheduledTime(null);
                          setEndDate(null);
                        }}
                        title="Remove date"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {scheduledDate && (
                    <div className={styles.optionalDateControls}>
                      {scheduledTime !== null ? (
                        <div className={styles.subDateWrapper}>
                          <input
                            type="time"
                            className={styles.timeInput}
                            value={scheduledTime || ''}
                            onChange={(e) => setScheduledTime(e.target.value || null)}
                            title="Time"
                            autoFocus
                          />
                          <button
                            type="button"
                            className={styles.subClearBtn}
                            onClick={() => setScheduledTime(null)}
                            title="Remove time"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.addOptionBtn}
                          onClick={() => setScheduledTime('09:00')}
                          title="Add specific time"
                        >
                          + Add Time
                        </button>
                      )}

                      {endDate !== null ? (
                        <div className={styles.subDateWrapper}>
                          <span className={styles.arrow}>→</span>
                          <input
                            type="date"
                            className={styles.dateInput}
                            value={endDate || ''}
                            min={scheduledDate}
                            onChange={(e) => setEndDate(e.target.value || null)}
                            title="End Date"
                            autoFocus
                          />
                          <button
                            type="button"
                            className={styles.subClearBtn}
                            onClick={() => setEndDate(null)}
                            title="Remove end date"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.addOptionBtn}
                          onClick={() => setEndDate(scheduledDate)}
                          title="Add end date for multi-day task"
                        >
                          + Multi-day
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                scheduledDate && (
                  <div className={styles.dateDisplay}>
                    <span>📅 {new Date(scheduledDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {scheduledTime && <span> at {scheduledTime}</span>}
                    {endDate && endDate !== scheduledDate && (
                      <span> → {new Date(endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    )}
                  </div>
                )
              )}
            </div>
          </div>

          <div className={styles.headerActions}>
            {!isEditing && (
              <button 
                type="button" 
                className={styles.editBtn} 
                onClick={() => setIsEditing(true)}
                title="Edit Note"
              >
                ✎
              </button>
            )}
            <button className={styles.closeBtn} onClick={handleCloseClick} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            {isEditing ? (
              <input
                id="note-title"
                type="text"
                className={styles.input}
                placeholder="Enter Title ..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            ) : (
              <h1 className={styles.viewTitle}>{title || 'Untitled'}</h1>
            )}
          </div>

          <div className={`${styles.inputGroup} ${styles.contentGroup}`}>
            <TipTapEditor 
              content={content} 
              onChange={setContent} 
              noteId={currentNoteId} 
              readOnly={!isEditing} 
            />
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={handleCancelClick}>
              {isEditing ? 'Cancel' : 'Close'}
            </button>
            {isEditing && (
              <button type="submit" className={styles.saveBtn}>
                Save Note
              </button>
            )}
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
