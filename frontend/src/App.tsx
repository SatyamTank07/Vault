import { useState, useEffect } from 'react';
import styles from './App.module.css';
import { NoteCard } from './components/NoteCard/NoteCard';
import type { Note } from './components/NoteCard/NoteCard';
import { NoteModal } from './components/NoteModal/NoteModal';
import { FloatingActionButton } from './components/FloatingActionButton/FloatingActionButton';

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // Load notes from localStorage on mount
  useEffect(() => {
    const savedNotes = localStorage.getItem('vault_notes');
    if (savedNotes) {
      try {
        setNotes(JSON.parse(savedNotes));
      } catch (e) {
        console.error('Failed to parse notes from local storage');
      }
    }
  }, []);

  // Save notes to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('vault_notes', JSON.stringify(notes));
  }, [notes]);

  const handleCreateNote = (noteData: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newNote: Note = {
      id: crypto.randomUUID(),
      ...noteData,
      createdAt: now,
      updatedAt: now,
    };
    setNotes(prev => [newNote, ...prev]);
  };

  const handleUpdateNote = (noteData: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!editingNote) return;
    
    const now = new Date().toISOString();
    setNotes(prev => prev.map(note => 
      note.id === editingNote.id 
        ? { ...note, ...noteData, updatedAt: now } 
        : note
    ));
  };

  const handleDeleteNote = (id: string) => {
    if (window.confirm('Are you sure you want to delete this note?')) {
      setNotes(prev => prev.filter(note => note.id !== id));
    }
  };

  const openCreateModal = () => {
    setEditingNote(null);
    setIsModalOpen(true);
  };

  const openEditModal = (note: Note) => {
    setEditingNote(note);
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
      />
    </div>
  );
}

export default App;
