import { useState, useEffect, useCallback } from 'react';
import styles from './App.module.css';
import { NoteCard } from './components/NoteCard/NoteCard';
import type { Note } from './components/NoteCard/NoteCard';
import { NoteModal } from './components/NoteModal/NoteModal';
import { ConfirmModal } from './components/ConfirmModal/ConfirmModal';
import { RecurrenceModal } from './components/RecurrenceModal/RecurrenceModal';
import { FloatingActionButton } from './components/FloatingActionButton/FloatingActionButton';
import { CanvasView } from './components/CanvasView/CanvasView';
import { TimelineView } from './components/TimelineView/TimelineView';
import { LayoutGrid, Network, CalendarDays } from 'lucide-react';

const API_BASE_URL = 'http://localhost:8000';

type ViewMode = 'grid' | 'canvas' | 'timeline';

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>('grid');
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

  // Global click handler to detect image clicks for Lightbox
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // If we click an image, enlarge it
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement;
        // Don't enlarge images that are already in the lightbox
        if (!img.closest('[class*="lightboxContent"]')) {
          setEnlargedImageUrl(img.src);
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    document.addEventListener('click', handleGlobalClick, true); // Use capture phase
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  const fetchNotes = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/notes/`);
      if (response.ok) {
        const data = await response.json();
        // Sort notes by updated_at or created_at descending if needed
        // Assuming the backend returns them in order, or we can sort them here
        data.sort((a: Note, b: Note) => 
          new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
        );
        setNotes(data);
      }
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleCreateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at' | 'scheduled_date' | 'status'>) => {
    try {
      const response = await fetch(`${API_BASE_URL}/notes/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(noteData),
      });
      if (response.ok) {
        const newNote = await response.json();
        setNotes(prev => [newNote, ...prev]);
      }
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const handleUpdateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at' | 'scheduled_date' | 'status'>) => {
    if (!editingNote) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/notes/${editingNote.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(noteData),
      });
      if (response.ok) {
        const updatedNote = await response.json();
        setNotes(prev => prev.map(note => 
          note.id === editingNote.id ? updatedNote : note
        ));
      }
    } catch (error) {
      console.error('Failed to update note:', error);
    }
  };

  const handleUpdateSchedule = async (noteId: string, date: string | null, status: string) => {
    // Optimistic update
    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId ? { ...note, scheduled_date: date, status } : note
      )
    );

    try {
      const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduled_date: date,
          clear_date: date === null,
          status,
        }),
      });
      if (!response.ok) {
        // Revert on failure
        fetchNotes();
      }
    } catch (error) {
      console.error('Failed to update schedule:', error);
      fetchNotes();
    }
  };

  const handleUpdateRecurrence = async (noteId: string, rule: string | null, interval: number, endDate: string | null) => {
    // Optimistic update
    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId
          ? { ...note, recurrence_rule: rule, recurrence_interval: interval, recurrence_end_date: endDate }
          : note
      )
    );

    try {
      const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}/recurrence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          rule
            ? {
                recurrence_rule: rule,
                recurrence_interval: interval,
                ...(endDate
                  ? { recurrence_end_date: endDate }
                  : { clear_end_date: true }),
              }
            : { clear_recurrence: true }
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
          const response = await fetch(`${API_BASE_URL}/notes/${id}`, {
            method: 'DELETE',
          });
          if (response.ok) {
            setNotes(prev => prev.filter(note => note.id !== id));
          }
        } catch (error) {
          console.error('Failed to delete note:', error);
        }
      }
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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <h1>Vault</h1>
            <p>Your secure, local note-taking space.</p>
          </div>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.toggleBtn} ${activeView === 'grid' ? styles.toggleActive : ''}`}
              onClick={() => setActiveView('grid')}
              title="Grid View"
            >
              <LayoutGrid size={16} />
              Grid
            </button>
            <button
              className={`${styles.toggleBtn} ${activeView === 'canvas' ? styles.toggleActive : ''}`}
              onClick={() => setActiveView('canvas')}
              title="Canvas View"
            >
              <Network size={16} />
              Canvas
            </button>
            <button
              className={`${styles.toggleBtn} ${activeView === 'timeline' ? styles.toggleActive : ''}`}
              onClick={() => setActiveView('timeline')}
              title="Timeline View"
            >
              <CalendarDays size={16} />
              Timeline
            </button>
          </div>
        </div>
      </header>

      {activeView === 'grid' ? (
        <>
          {notes.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No notes yet.</p>
              <p>Click the + button to create your first note!</p>
            </div>
          ) : (
            <div className={styles.notesGrid}>
              {notes.map(note => (
                <NoteCard 
                  key={note.id} 
                  note={note} 
                  onEdit={openEditModal}
                  onDelete={handleDeleteNote}
                  onView={openViewModal}
                  onUpdateSchedule={handleUpdateSchedule}
                  onRecurrenceClick={(n) => setRecurrenceNote(n)}
                />
              ))}
            </div>
          )}

          <FloatingActionButton onClick={openCreateModal} />
        </>
      ) : activeView === 'canvas' ? (
        <CanvasView 
          onOpenNote={openViewModal} 
          onRecurrenceClick={(n) => setRecurrenceNote(n)}
          fetchNotes={fetchNotes} 
          notes={notes} 
        />
      ) : (
        <TimelineView onOpenNote={openViewModal} />
      )}

      <NoteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={editingNote ? handleUpdateNote : handleCreateNote}
        initialData={editingNote}
        isViewMode={isViewMode}
      />

      {/* Lightbox Overlay */}
      {enlargedImageUrl && (
        <div 
          className={styles.lightboxOverlay} 
          onClick={() => setEnlargedImageUrl(null)}
          title="Click anywhere to close"
        >
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

