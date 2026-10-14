import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  Eye,
  EyeOff,
  LayoutGrid,
  Lock,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  Plus,
  Sun,
  User,
  UserX,
} from 'lucide-react';
import styles from './App.module.css';
import { CanvasView, type CanvasViewActions } from './components/CanvasView/CanvasView';
import { ConfirmModal } from './components/ConfirmModal/ConfirmModal';
import { FeedbackModal } from './components/FeedbackModal/FeedbackModal';
import { NoteModal } from './components/NoteModal/NoteModal';
import { NoteCard, type Note } from './components/NoteCard/NoteCard';
import { SearchBox } from './components/SearchBox/SearchBox';
import { TimelineView, type TimelineViewActions } from './components/TimelineView/TimelineView';
import { Menu, MenuItem, MenuSeparator } from './components/ui/Menu';
import { SegmentedControl } from './components/ui/SegmentedControl';
import { Toolbar } from './components/ui/Toolbar';
import ui from './components/ui/ui.module.css';
import { apiFetch, referencedUploads, type CurrentUser } from './lib/api';
import { encryptNote, decryptNote } from './lib/crypto';
import { isTask, plainText } from './lib/noteText';
import { parentSaveOrder, withLiveHierarchy } from './lib/noteTree';
import { setThemePref, useThemePref, type ThemePref } from './lib/theme';

async function putNoteParent(noteId: string, parentId: string | null): Promise<void> {
  try {
    const response = await apiFetch(`/api/notes/${noteId}/parent`, {
      method: 'PUT',
      body: JSON.stringify(parentId ? { parent_note_id: parentId } : { clear_parent: true }),
    });
    if (!response.ok) {
      console.error('Failed to set parent:', await response.text());
    }
  } catch (error) {
    console.error('Failed to set parent:', error);
  }
}

type ViewMode = 'grid' | 'canvas' | 'schedule';
type GridFilter = 'all' | 'tasks' | 'notes';

const THEME_OPTIONS: { value: ThemePref; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={15} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={15} /> },
  { value: 'system', label: 'System', icon: <Monitor size={15} /> },
];

interface AppProps {
  currentUser: CurrentUser;
  onLogout: () => void;
  cryptoKey: CryptoKey;
}

function App({ currentUser, onLogout, cryptoKey }: AppProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [modalPopover, setModalPopover] = useState<'schedule' | null>(null);
  const [newNoteDate, setNewNoteDate] = useState<string | null>(null);
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>('grid');
  const [wrongSecret, setWrongSecret] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [gridFilter, setGridFilter] = useState<GridFilter>('all');
  const [query, setQuery] = useState('');
  const [childParentId, setChildParentId] = useState<string | null>(null);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Delete',
    isDestructive: true,
    onConfirm: () => {},
  });
  const canvasActionsRef = useRef<CanvasViewActions>(null);
  const timelineActionsRef = useRef<TimelineViewActions>(null);
  const themePref = useThemePref();
  const closeUserMenu = useCallback(() => setUserMenuAnchor(null), []);

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'IMG') {
        const image = target as HTMLImageElement;
        // In the editor a click selects the image (e.g. to delete it); it shouldn't open the lightbox.
        if (image.closest('.ProseMirror[contenteditable="true"]')) return;
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
      const response = await apiFetch('/notes/?limit=1000');
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

  const handleCreateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at'>) => {
    try {
      const payload = {
        ...noteData,
        status: noteData.status !== undefined ? noteData.status : null,
        scheduled_date: noteData.scheduled_date || null,
        scheduled_time: noteData.scheduled_time || null,
        end_date: noteData.end_date || null,
        recurrence_rule: noteData.recurrence_rule || null,
        recurrence_interval: noteData.recurrence_interval || 1,
        recurrence_end_date: noteData.recurrence_end_date || null,
        parent_note_id: noteData.parent_note_id || null,
        ...(noteData.canvas_only !== undefined ? { canvas_only: noteData.canvas_only } : {}),
        referenced_uploads: referencedUploads(noteData.content, noteData.id),
      };
      const encrypted = await encryptNote(payload, cryptoKey);
      const response = await apiFetch('/notes/', {
        method: 'POST',
        body: JSON.stringify(encrypted),
      });
      if (response.ok) {
        const newNote = await response.json();
        const { note: decrypted } = await decryptNote(newNote, cryptoKey);
        setNotes((prev) => [decrypted, ...prev]);
        if (payload.parent_note_id) {
          fetchNotes();
        }
      }
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const handleSetParent = useCallback(
    async (noteId: string, parentId: string | null) => {
      await putNoteParent(noteId, parentId);
      // Parent changes can mirror canvas nodes and flip visibility on other rows.
      fetchNotes();
    },
    [fetchNotes],
  );

  const handleUpdateNote = async (noteData: Omit<Note, 'created_at' | 'updated_at'>) => {
    const previousParent = notes.find((n) => n.id === noteData.id)?.parent_note_id ?? null;
    const parentOrder = parentSaveOrder(previousParent, noteData.parent_note_id);
    try {
      if (parentOrder === 'before') {
        await putNoteParent(noteData.id, noteData.parent_note_id ?? null);
      }
      const payload = {
        ...noteData,
        status: noteData.status !== undefined ? noteData.status : null,
        scheduled_date: noteData.scheduled_date || null,
        scheduled_time: noteData.scheduled_time || null,
        end_date: noteData.end_date || null,
        recurrence_rule: noteData.recurrence_rule || null,
        recurrence_interval: noteData.recurrence_interval || 1,
        recurrence_end_date: noteData.recurrence_end_date || null,
        parent_note_id: noteData.parent_note_id || null,
        ...(noteData.canvas_only !== undefined ? { canvas_only: noteData.canvas_only } : {}),
        referenced_uploads: referencedUploads(noteData.content, noteData.id),
      };
      const encrypted = await encryptNote(payload, cryptoKey);
      const response = await apiFetch(`/notes/${noteData.id}`, {
        method: 'PUT',
        body: JSON.stringify(encrypted),
      });
      if (response.ok) {
        const updatedNote = await response.json();
        const { note: decrypted } = await decryptNote(updatedNote, cryptoKey);
        setNotes((prev) =>
          prev.map((n) => (n.id === decrypted.id ? decrypted : n)),
        );
      }
      if (parentOrder === 'after') {
        await putNoteParent(noteData.id, null);
      }
    } catch (error) {
      console.error('Failed to update note:', error);
    } finally {
      if (parentOrder !== 'none') {
        // Parent changes can mirror canvas nodes and flip visibility on other rows.
        fetchNotes();
      }
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
        // Clearing the date also clears the repeat (the server does the same).
        const clearedRepeat = date ? {} : { recurrence_rule: null, recurrence_interval: 1, recurrence_end_date: null };
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId
              ? { ...n, scheduled_date: date, scheduled_time: time, end_date: finalEndDate, status, ...clearedRepeat }
              : n,
          ),
        );
      }
    } catch (error) {
      console.error('Failed to update schedule:', error);
      fetchNotes();
    }
  };

  const handleDeleteNote = (id: string) => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete note',
      message: 'This note will be deleted for good. This cannot be undone.',
      confirmText: 'Delete note',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const response = await apiFetch(`/notes/${id}`, { method: 'DELETE' });
          if (response.ok) {
            setNotes((prev) => prev.filter((note) => note.id !== id));
            // The server detached and may have un-hidden this note's children.
            fetchNotes();
          }
        } catch (error) {
          console.error('Failed to delete note:', error);
        }
      },
    });
  };

  const handleDeleteAccount = () => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete account',
      message: 'All your notes, canvases and uploaded files will be erased for good. This cannot be undone.',
      confirmText: 'Delete account',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const response = await apiFetch('/api/auth/me', { method: 'DELETE' });
          if (response.ok) {
            onLogout();
          } else {
            alert('Failed to delete account. Please try again.');
          }
        } catch (error) {
          console.error('Failed to delete account:', error);
          alert('Network error while deleting account.');
        }
      },
    });
  };

  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);

  const openModal = (
    note: Note | null,
    options: { parentId?: string | null; date?: string | null; popover?: 'schedule' | null } = {},
  ) => {
    // Views like the schedule cache their own note copies; never let a stale parent/visibility reach the modal.
    const live = note ? notesById.get(note.id) ?? note : null;
    setEditingNote(live ? withLiveHierarchy(live, notesById) : null);
    setChildParentId(options.parentId ?? null);
    setNewNoteDate(options.date ?? null);
    setModalPopover(options.popover ?? null);
    setIsModalOpen(true);
  };

  const openNote = (note: Note) => openModal(note);
  const openScheduleEditor = (note: Note) => openModal(note, { popover: 'schedule' });
  const openCreateChildModal = (parentId: string) => openModal(null, { parentId });

  // New note fills in context: the open canvas, or the day the schedule is showing.
  const handleNewNote = () => {
    if (activeView === 'canvas' && canvasActionsRef.current?.createNote()) return;
    if (activeView === 'schedule') {
      openModal(null, { date: timelineActionsRef.current?.getContextDate() ?? null });
      return;
    }
    openModal(null);
  };

  const gridBase = useMemo(
    () => notes.filter((note) => !note.canvas_only && (showCompleted || note.status !== 'done')),
    [notes, showCompleted],
  );
  const gridCounts = useMemo(() => {
    const tasks = gridBase.filter(isTask).length;
    return { all: gridBase.length, tasks, notes: gridBase.length - tasks };
  }, [gridBase]);
  const gridNotes = useMemo(() => {
    let list = gridBase;
    if (gridFilter === 'tasks') list = list.filter(isTask);
    if (gridFilter === 'notes') list = list.filter((note) => !isTask(note));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((note) => `${note.title} ${plainText(note.content || '')}`.toLowerCase().includes(q));
    return list;
  }, [gridBase, gridFilter, query]);

  // Null-key guard (defense in depth — Root.tsx should prevent this)
  if (!cryptoKey) {
    return (
      <div className={styles.app}>
        <div className={styles.lockedState}>
          <Lock size={48} />
          <p>Vault is locked. Please enter your Vault Secret.</p>
        </div>
      </div>
    );
  }

  const renderGrid = () => (
    <>
      <Toolbar
        left={
          <>
            <span className={ui.tbTitle}>All notes</span>
            <span className={ui.tbSub}>{gridNotes.length} shown</span>
          </>
        }
        right={
          <SegmentedControl<GridFilter>
            size="sm"
            ariaLabel="Filter notes"
            value={gridFilter}
            onChange={setGridFilter}
            options={[
              { value: 'all', label: 'All', count: gridCounts.all },
              { value: 'tasks', label: 'Tasks', count: gridCounts.tasks },
              { value: 'notes', label: 'Notes', count: gridCounts.notes },
            ]}
          />
        }
      />
      <div className={styles.scroll}>
        {gridNotes.length === 0 ? (
          <div className={ui.empty}>
            {query.trim() ? (
              <>
                <strong>No notes match “{query.trim()}”</strong>
                Try a shorter word.
              </>
            ) : notes.length === 0 ? (
              <>
                <strong>Nothing here yet</strong>
                Use New note to write your first one.
              </>
            ) : (
              <>
                <strong>Nothing to show</strong>
                {showCompleted ? 'Try another filter.' : 'Completed notes are hidden. Use Show done to see them.'}
              </>
            )}
          </div>
        ) : (
          <div className={styles.cards}>
            {gridNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onOpen={openNote}
                onDelete={handleDeleteNote}
                onUpdateSchedule={handleUpdateSchedule}
                onEditSchedule={openScheduleEditor}
                cryptoKey={cryptoKey}
                parentNote={note.parent_note_id ? notesById.get(note.parent_note_id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className={styles.app}>
      <header className={styles.hdr}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Lock size={18} />
          </span>
          <span className={styles.brandName}>Vault</span>
        </div>

        <SegmentedControl<ViewMode>
          ariaLabel="Views"
          value={activeView}
          onChange={setActiveView}
          options={[
            { value: 'grid', label: 'Grid', icon: <LayoutGrid size={16} />, title: 'Grid', labelClassName: styles.segLabel },
            { value: 'canvas', label: 'Canvas', icon: <Network size={16} />, title: 'Canvas', labelClassName: styles.segLabel },
            { value: 'schedule', label: 'Schedule', icon: <CalendarDays size={16} />, title: 'Schedule', labelClassName: styles.segLabel },
          ]}
        />

        <div className={styles.hdrActions}>
          <SearchBox
            notes={notes}
            query={query}
            onQueryChange={setQuery}
            onOpen={(note) => {
              setQuery('');
              openNote(note);
            }}
          />
          <span className={styles.hdrSep} aria-hidden="true" />
          <button
            type="button"
            className={`${ui.btn} ${ui.ghost} ${showCompleted ? ui.on : ''} ${styles.hdrBtn}`}
            onClick={() => setShowCompleted(!showCompleted)}
            title={showCompleted ? 'Hide completed notes' : 'Show completed notes'}
            aria-pressed={showCompleted}
          >
            {showCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
            <span className={styles.btnLabel}>{showCompleted ? 'Hide done' : 'Show done'}</span>
          </button>
          <button type="button" className={`${ui.btn} ${ui.primary} ${styles.hdrBtn}`} onClick={handleNewNote} title="New note">
            <Plus size={16} />
            <span className={styles.btnLabel}>New note</span>
          </button>
          <button
            type="button"
            className={styles.avatar}
            onClick={(event) => {
              const target = event.currentTarget;
              setUserMenuAnchor((prev) => (prev ? null : target));
            }}
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={userMenuAnchor !== null}
          >
            <User size={17} />
          </button>
          <Menu anchor={userMenuAnchor} open={userMenuAnchor !== null} onClose={closeUserMenu} align="end" label="Account" minWidth={220}>
            <div className={ui.menuHead}>
              <User size={15} />
              <span className="tnum">{currentUser.mobile_number}</span>
            </div>
            <MenuSeparator />
            <div className={ui.menuLabel}>Theme</div>
            {THEME_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                icon={option.icon}
                selected={themePref === option.value}
                onSelect={() => setThemePref(option.value)}
              >
                {option.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              icon={<MessageSquare size={15} />}
              onSelect={() => {
                closeUserMenu();
                setIsFeedbackModalOpen(true);
              }}
            >
              Feedback
            </MenuItem>
            <MenuItem
              icon={<LogOut size={15} />}
              onSelect={() => {
                closeUserMenu();
                onLogout();
              }}
            >
              Log out
            </MenuItem>
            <MenuItem
              danger
              icon={<UserX size={15} />}
              onSelect={() => {
                closeUserMenu();
                handleDeleteAccount();
              }}
            >
              Delete account
            </MenuItem>
          </Menu>
        </div>
      </header>

      <main className={styles.view}>
        {wrongSecret ? (
          <div className={styles.wrongSecretBanner}>
            <span>Wrong vault secret. Log out and try again.</span>
            <button type="button" className={`${ui.btn} ${ui.danger} ${ui.sm}`} onClick={onLogout}>
              Log out
            </button>
          </div>
        ) : activeView === 'grid' ? (
          renderGrid()
        ) : activeView === 'canvas' ? (
          <CanvasView
            actionsRef={canvasActionsRef}
            currentUserId={currentUser.id}
            onOpenNote={openNote}
            onRecurrenceClick={openScheduleEditor}
            fetchNotes={fetchNotes}
            notes={showCompleted ? notes : notes.filter((n) => n.status !== 'done')}
            cryptoKey={cryptoKey}
          />
        ) : (
          <TimelineView
            actionsRef={timelineActionsRef}
            onOpenNote={openNote}
            notes={notes}
            fetchNotes={fetchNotes}
            cryptoKey={cryptoKey}
            showCompleted={showCompleted}
            onCreateChild={openCreateChildModal}
            onSetParent={handleSetParent}
          />
        )}
      </main>

      <NoteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={editingNote ? handleUpdateNote : handleCreateNote}
        initialData={editingNote}
        cryptoKey={cryptoKey}
        allNotes={notes}
        defaultParentId={childParentId}
        defaultCanvasOnly={childParentId !== null}
        defaultScheduledDate={newNoteDate}
        initialPopover={modalPopover}
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
        confirmText={confirmModalConfig.confirmText || 'Delete'}
        isDestructive={confirmModalConfig.isDestructive ?? true}
      />

      <FeedbackModal isOpen={isFeedbackModalOpen} onClose={() => setIsFeedbackModalOpen(false)} />
    </div>
  );
}

export default App;
