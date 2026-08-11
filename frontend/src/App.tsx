import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, LayoutGrid, Network, LogOut, MessageSquare, Lock, Eye, EyeOff, Waves } from 'lucide-react';
import styles from './App.module.css';
import { CanvasView } from './components/CanvasView/CanvasView';
import { ConfirmModal } from './components/ConfirmModal/ConfirmModal';
import { FloatingActionButton } from './components/FloatingActionButton/FloatingActionButton';
import { NoteModal } from './components/NoteModal/NoteModal';
import { NoteCard, type Note } from './components/NoteCard/NoteCard';
import { RecurrenceModal } from './components/RecurrenceModal/RecurrenceModal';
import { TimelineView } from './components/TimelineView/TimelineView';
import { TimeStreamView } from './components/TimeStreamView/TimeStreamView';
import { apiFetch, type CurrentUser } from './lib/api';
import { encryptNote, decryptNote } from './lib/crypto';

type ViewMode = 'grid' | 'canvas' | 'timeline' | 'stream';

interface AppProps {
  currentUser: CurrentUser;
  onLogout: () => void;
  cryptoKey: CryptoKey;
}

function App({ currentUser, onLogout, cryptoKey }: AppProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>('grid');
  const [wrongSecret, setWrongSecret] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);


  const [recurrenceNote, setRecurrenceNote] = useState<Note | null>(null);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'IMG') {
        const image = target as HTMLImageElement;
        if (!image.closest('[class*="lightboxContent"]')) {
          setEnlargedImageUrl(image.src);
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  const fetchNotes = useCallback(async () => {
    try {
      const response = await apiFetch('/notes/');
      if (response.ok) {
        const data: Note[] = await response.json();

        // Decrypt all notes
        const results = await Promise.all(
          data.map((note) => decryptNote(note, cryptoKey)),
        );

        const decryptedNotes = results.map((r) => r.note);
        const failedCount = results.filter((r) => r.failed).length;

        // If ALL notes failed and there were notes to decrypt, it's a wrong secret
        if (failedCount > 0 && failedCount === results.length) {
          setWrongSecret(true);
        } else {
          setWrongSecret(false);
        }

        decryptedNotes.sort(
          (a, b) =>
            new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime(),
        );
        setNotes(decryptedNotes);
      }
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    }
  }, [cryptoKey]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleCreateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at' | 'status'>) => {
    try {
      const { scheduled_date, scheduled_time, end_date, ...baseNoteData } = noteData;
      const encrypted = await encryptNote(baseNoteData, cryptoKey);
      const response = await apiFetch('/notes/', {
        method: 'POST',
        body: JSON.stringify(encrypted),
      });
      if (response.ok) {
        const newNote = await response.json();
        
        if (scheduled_date !== undefined) {
          await apiFetch(`/api/notes/${newNote.id}/schedule`, {
            method: 'PUT',
            body: JSON.stringify({
              scheduled_date,
              scheduled_time,
              end_date,
              clear_date: !scheduled_date,
              clear_time: !scheduled_time,
              clear_end_date: !end_date
            })
          });
        }
        
        const { note: decrypted } = await decryptNote(newNote, cryptoKey);
        // Note: the decrypted note from the POST /notes/ won't have the schedule info attached.
        // We call fetchNotes() anyway after creating/updating from the modal, but let's append it manually if needed, or just rely on fetchNotes.
        setNotes((prev) => [{...decrypted, scheduled_date, scheduled_time, end_date}, ...prev]);
        fetchNotes();
      }
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const handleUpdateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at' | 'status'>) => {
    try {
      const { scheduled_date, scheduled_time, end_date, ...baseNoteData } = noteData;
      const encrypted = await encryptNote(baseNoteData, cryptoKey);
      const response = await apiFetch(`/notes/${noteData.id}`, {
        method: 'PUT',
        body: JSON.stringify(encrypted),
      });
      if (response.ok) {
        const updatedNote = await response.json();
        
        if (scheduled_date !== undefined) {
          await apiFetch(`/api/notes/${noteData.id}/schedule`, {
            method: 'PUT',
            body: JSON.stringify({
              scheduled_date,
              scheduled_time,
              end_date,
              clear_date: !scheduled_date,
              clear_time: !scheduled_time,
              clear_end_date: !end_date
            })
          });
        }

        const { note: decrypted } = await decryptNote(updatedNote, cryptoKey);
        setNotes((prev) =>
          prev.map((n) => (n.id === decrypted.id ? { ...decrypted, scheduled_date, scheduled_time, end_date } : n)),
        );
        fetchNotes();
      }
    } catch (error) {
      console.error('Failed to update note:', error);
    }
  };

  const handleUpdateSchedule = async (noteId: string, date: string | null, time: string | null, status: string) => {
    try {
      const note = notes.find((n) => n.id === noteId);
      let finalEndDate = note?.end_date || null;
      if (!date) {
        finalEndDate = null;
      } else if (finalEndDate && date > finalEndDate) {
        finalEndDate = date;
      }

      const response = await apiFetch(`/api/notes/${noteId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({
          scheduled_date: date,
          scheduled_time: time,
          end_date: finalEndDate,
          clear_date: !date,
          clear_time: !time,
          clear_end_date: !finalEndDate,
          status,
        }),
      });
      if (response.ok) {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, scheduled_date: date, scheduled_time: time, end_date: finalEndDate, status } : n)),
        );
      }
    } catch (error) {
      console.error('Failed to update schedule:', error);
      fetchNotes();
    }
  };

  const handleUpdateRecurrence = async (noteId: string, rule: string | null, interval: number, endDate: string | null) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId
          ? { ...note, recurrence_rule: rule, recurrence_interval: interval, recurrence_end_date: endDate }
          : note,
      ),
    );

    try {
      const response = await apiFetch(`/api/notes/${noteId}/recurrence`, {
        method: 'PUT',
        body: JSON.stringify(
          rule
            ? {
                recurrence_rule: rule,
                recurrence_interval: interval,
                ...(endDate ? { recurrence_end_date: endDate } : { clear_end_date: true }),
              }
            : { clear_recurrence: true },
        ),
      });
      if (!response.ok) {
        fetchNotes();
      }
    } catch (error) {
      console.error('Failed to update recurrence:', error);
      fetchNotes();
    }
  };

  const handleDeleteNote = (id: string) => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete Note',
      message: 'Are you sure you want to delete this note?',
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const response = await apiFetch(`/notes/${id}`, { method: 'DELETE' });
          if (response.ok) {
            setNotes((prev) => prev.filter((note) => note.id !== id));
          }
        } catch (error) {
          console.error('Failed to delete note:', error);
        }
      },
    });
  };

  const openCreateModal = () => {
    setEditingNote(null);
    setIsViewMode(false);
    setIsModalOpen(true);
  };

  const openEditModal = (note: Note) => {
    setEditingNote(note);
    setIsViewMode(false);
    setIsModalOpen(true);
  };

  const openViewModal = (note: Note) => {
    setEditingNote(note);
    setIsViewMode(true);
    setIsModalOpen(true);
  };

  // Null-key guard (defense in depth — Root.tsx should prevent this)
  if (!cryptoKey) {
    return (
      <div className={styles.container}>
        <div className={styles.lockedState}>
          <Lock size={48} />
          <p>Vault is locked. Please enter your Vault Secret.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.brand}>
            <h1>Vault</h1>
            <p>{currentUser.mobile_number}</p>
          </div>
          <div className={styles.headerActions}>
            <button 
              className={styles.actionBtn} 
              onClick={() => (window.location.href = '/feedback')} 
              title="Feedback"
            >
              <MessageSquare size={20} />
            </button>
            <button 
              className={styles.actionBtn} 
              onClick={onLogout} 
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

        <div className={styles.viewToggle}>
          <div className={styles.carouselPill}>
            <div className={styles.carouselTrack}>
              <div 
                className={`${styles.carouselItem} ${activeView === 'grid' ? styles.active : ''}`}
                onClick={() => setActiveView('grid')}
              >
                <LayoutGrid size={16} />
                <span>Grid</span>
              </div>
              <div 
                className={`${styles.carouselItem} ${activeView === 'canvas' ? styles.active : ''}`}
                onClick={() => setActiveView('canvas')}
              >
                <Network size={16} />
                <span>Canvas</span>
              </div>
              <div 
                className={`${styles.carouselItem} ${activeView === 'timeline' ? styles.active : ''}`}
                onClick={() => setActiveView('timeline')}
              >
                <CalendarDays size={16} />
                <span>Timeline</span>
              </div>
              <div 
                className={`${styles.carouselItem} ${activeView === 'stream' ? styles.active : ''}`}
                onClick={() => setActiveView('stream')}
              >
                <Waves size={16} />
                <span>Stream</span>
              </div>
              <div 
                className={styles.carouselItem}
                onClick={() => setShowCompleted(!showCompleted)}
              >
                {showCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
                <span>{showCompleted ? 'Hide Done' : 'Show Done'}</span>
              </div>
              <div 
                className={`${styles.carouselItem} ${styles.desktopOnly}`}
                onClick={() => (window.location.href = '/feedback')}
              >
                <MessageSquare size={16} />
                <span>Feedback</span>
              </div>
              <div 
                className={`${styles.carouselItem} ${styles.desktopOnly}`}
                onClick={onLogout}
              >
                <LogOut size={16} />
                <span>Logout</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {wrongSecret ? (
        <div className={styles.wrongSecretBanner}>
          <span>Wrong vault secret — please log out and try again.</span>
          <button onClick={onLogout}>Log Out</button>
        </div>
      ) : activeView === 'grid' ? (
        <>
          {notes.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No notes yet.</p>
              <p>Click the + button to create your first note.</p>
            </div>
          ) : (
            <div className={styles.notesGrid}>
              {(showCompleted ? notes : notes.filter(n => n.status !== 'done')).map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onEdit={openEditModal}
                  onDelete={handleDeleteNote}
                  onView={openViewModal}
                  onUpdateSchedule={handleUpdateSchedule}
                  onRecurrenceClick={(nextNote) => setRecurrenceNote(nextNote)}
                />
              ))}
            </div>
          )}

          <FloatingActionButton onClick={openCreateModal} />
        </>
      ) : activeView === 'canvas' ? (
        <CanvasView
          currentUserId={currentUser.id}
          onOpenNote={openViewModal}
          onRecurrenceClick={(nextNote) => setRecurrenceNote(nextNote)}
          fetchNotes={fetchNotes}
          notes={showCompleted ? notes : notes.filter(n => n.status !== 'done')}
          cryptoKey={cryptoKey}
        />
      ) : activeView === 'timeline' ? (
        <TimelineView onOpenNote={openViewModal} notes={notes} fetchNotes={fetchNotes} cryptoKey={cryptoKey} showCompleted={showCompleted} />
      ) : activeView === 'stream' ? (
        <TimeStreamView onOpenNote={openViewModal} notes={notes} fetchNotes={fetchNotes} cryptoKey={cryptoKey} showCompleted={showCompleted} />
      ) : null}

      <NoteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={editingNote ? handleUpdateNote : handleCreateNote}
        initialData={editingNote}
        isViewMode={isViewMode}
      />

      {enlargedImageUrl && (
        <div className={styles.lightboxOverlay} onClick={() => setEnlargedImageUrl(null)} title="Click anywhere to close">
          <div className={styles.lightboxContent}>
            <img src={enlargedImageUrl} alt="Enlarged" />
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmModalConfig.isOpen}
        title={confirmModalConfig.title}
        message={confirmModalConfig.message}
        onConfirm={confirmModalConfig.onConfirm}
        onCancel={() => setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }))}
        confirmText="Delete"
      />

      <RecurrenceModal
        isOpen={recurrenceNote !== null}
        onClose={() => setRecurrenceNote(null)}
        onSave={(rule, interval, endDate) => {
          if (recurrenceNote) {
            handleUpdateRecurrence(recurrenceNote.id, rule, interval, endDate);
          }
        }}
        initialRule={recurrenceNote?.recurrence_rule}
        initialInterval={recurrenceNote?.recurrence_interval}
        initialEndDate={recurrenceNote?.recurrence_end_date}
        scheduledDate={recurrenceNote?.scheduled_date}
      />
    </div>
  );
}

export default App;
