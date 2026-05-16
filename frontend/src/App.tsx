import { useCallback, useEffect, useState, useRef } from 'react';
import { CalendarDays, LayoutGrid, Network, LogOut, MessageSquare } from 'lucide-react';
import styles from './App.module.css';
import { CanvasView } from './components/CanvasView/CanvasView';
import { ConfirmModal } from './components/ConfirmModal/ConfirmModal';
import { FloatingActionButton } from './components/FloatingActionButton/FloatingActionButton';
import { NoteModal } from './components/NoteModal/NoteModal';
import { NoteCard, type Note } from './components/NoteCard/NoteCard';
import { RecurrenceModal } from './components/RecurrenceModal/RecurrenceModal';
import { TimelineView } from './components/TimelineView/TimelineView';
import { apiFetch, type CurrentUser } from './lib/api';

type ViewMode = 'grid' | 'canvas' | 'timeline';

interface AppProps {
  currentUser: CurrentUser;
  onLogout: () => void;
}

function App({ currentUser, onLogout }: AppProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>('grid');
  const navRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  const scrollToView = useCallback((index: number) => {
    if (navRef.current && window.innerWidth <= 600) {
      const track = navRef.current;
      const items = track.querySelectorAll(`.${styles.carouselItem}`);
      const targetItem = items[index] as HTMLElement;
      if (targetItem) {
        isScrollingRef.current = true;
        track.scrollTo({
          left: targetItem.offsetLeft,
          behavior: 'smooth'
        });
        // Reset scroll flag after animation
        setTimeout(() => {
          isScrollingRef.current = false;
        }, 500);
      }
    }
  }, []);

  const handleNavScroll = () => {
    if (!navRef.current || window.innerWidth > 600 || isScrollingRef.current) return;
    
    const container = navRef.current;
    const containerCenter = container.scrollLeft + container.offsetWidth / 2;
    const items = container.querySelectorAll(`.${styles.carouselItem}`);
    
    let closestIndex = 0;
    let minDistance = Infinity;
    
    items.forEach((item, index) => {
      const itemEl = item as HTMLElement;
      const itemCenter = itemEl.offsetLeft + itemEl.offsetWidth / 2;
      const distance = Math.abs(containerCenter - itemCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });
    
    const views: ViewMode[] = ['grid', 'canvas', 'timeline'];
    if (views[closestIndex] && views[closestIndex] !== activeView) {
      setActiveView(views[closestIndex]);
    }
  };

  useEffect(() => {
    const views: ViewMode[] = ['grid', 'canvas', 'timeline'];
    const index = views.indexOf(activeView);
    if (index !== -1) {
      scrollToView(index);
    }
  }, [activeView, scrollToView]);
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
        const data = await response.json();
        data.sort(
          (a: Note, b: Note) =>
            new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime(),
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
      const response = await apiFetch('/notes/', {
        method: 'POST',
        body: JSON.stringify(noteData),
      });
      if (response.ok) {
        const newNote = await response.json();
        setNotes((prev) => [newNote, ...prev]);
      }
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const handleUpdateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at' | 'scheduled_date' | 'status'>) => {
    if (!editingNote) return;

    try {
      const response = await apiFetch(`/notes/${editingNote.id}`, {
        method: 'PUT',
        body: JSON.stringify(noteData),
      });
      if (response.ok) {
        const updatedNote = await response.json();
        setNotes((prev) => prev.map((note) => (note.id === editingNote.id ? updatedNote : note)));
      }
    } catch (error) {
      console.error('Failed to update note:', error);
    }
  };

  const handleUpdateSchedule = async (noteId: string, date: string | null, status: string) => {
    setNotes((prev) => prev.map((note) => (note.id === noteId ? { ...note, scheduled_date: date, status } : note)));

    try {
      const response = await apiFetch(`/api/notes/${noteId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({
          scheduled_date: date,
          clear_date: date === null,
          status,
        }),
      });
      if (!response.ok) {
        fetchNotes();
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
            <div 
              className={styles.carouselTrack} 
              ref={navRef}
              onScroll={handleNavScroll}
            >
              <div 
                className={`${styles.carouselItem} ${activeView === 'grid' ? styles.active : ''}`}
                onClick={() => {
                  setActiveView('grid');
                  scrollToView(0);
                }}
              >
                <LayoutGrid size={16} />
                <span>Grid</span>
              </div>
              <div 
                className={`${styles.carouselItem} ${activeView === 'canvas' ? styles.active : ''}`}
                onClick={() => {
                  setActiveView('canvas');
                  scrollToView(1);
                }}
              >
                <Network size={16} />
                <span>Canvas</span>
              </div>
              <div 
                className={`${styles.carouselItem} ${activeView === 'timeline' ? styles.active : ''}`}
                onClick={() => {
                  setActiveView('timeline');
                  scrollToView(2);
                }}
              >
                <CalendarDays size={16} />
                <span>Timeline</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {activeView === 'grid' ? (
        <>
          {notes.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No notes yet.</p>
              <p>Click the + button to create your first note.</p>
            </div>
          ) : (
            <div className={styles.notesGrid}>
              {notes.map((note) => (
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
          notes={notes}
        />
      ) : (
        <TimelineView onOpenNote={openViewModal} notes={notes} fetchNotes={fetchNotes} />
      )}

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
