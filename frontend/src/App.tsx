import { useState, useEffect } from 'react';
import styles from './App.module.css';
import { NoteCard } from './components/NoteCard/NoteCard';
import type { Note } from './components/NoteCard/NoteCard';
import { NoteModal } from './components/NoteModal/NoteModal';
import { FloatingActionButton } from './components/FloatingActionButton/FloatingActionButton';

const API_BASE_URL = 'http://localhost:8000';

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null);

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

  const fetchNotes = async () => {
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
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  const handleCreateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at'>) => {
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

  const handleUpdateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at'>) => {
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

  const handleDeleteNote = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this note?')) {
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
        <h1>Vault</h1>
        <p>Your secure, local note-taking space.</p>
      </header>

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
            />
          ))}
        </div>
      )}

      <FloatingActionButton onClick={openCreateModal} />

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
    </div>
  );
}

export default App;
