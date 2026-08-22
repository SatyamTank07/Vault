import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LogOut, UserX, User } from 'lucide-react';
import styles from './App.module.css';
import { ConfirmModal } from './components/ConfirmModal/ConfirmModal';
import { FeedbackModal, type Feedback } from './components/FeedbackModal/FeedbackModal';
import { FloatingActionButton } from './components/FloatingActionButton/FloatingActionButton';
import { apiFetch, type CurrentUser } from './lib/api';

interface FeedbackAppProps {
  currentUser: CurrentUser;
  onLogout: () => void;
}

export function FeedbackApp({ currentUser, onLogout }: FeedbackAppProps) {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState<Feedback | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [confirmModalConfig, setConfirmModalConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as HTMLElement)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDeleteAccount = () => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete Account',
      message: 'Are you sure you want to permanently delete your account? All your notes, canvases, feedbacks, and uploaded files will be permanently erased. This action cannot be undone.',
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

  const fetchFeedbacks = useCallback(async () => {
    try {
      const response = await apiFetch('/api/feedback/');
      if (response.ok) {
        const data = await response.json();
        setFeedbacks(data);
      }
    } catch (error) {
      console.error('Failed to fetch feedbacks:', error);
    }
  }, []);

  useEffect(() => {
    fetchFeedbacks();
  }, [fetchFeedbacks]);

  const handleCreateFeedback = async (data: Omit<Feedback, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const response = await apiFetch('/api/feedback/', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (response.ok) {
        const newFeedback = await response.json();
        setFeedbacks((prev) => [newFeedback, ...prev]);
      }
    } catch (error) {
      console.error('Failed to create feedback:', error);
    }
  };

  const handleUpdateFeedback = async (data: Omit<Feedback, 'id' | 'created_at' | 'updated_at'>) => {
    if (!editingFeedback) return;
    try {
      const response = await apiFetch(`/api/feedback/${editingFeedback.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (response.ok) {
        const updatedFeedback = await response.json();
        setFeedbacks((prev) => prev.map((feedback) => (feedback.id === editingFeedback.id ? updatedFeedback : feedback)));
      }
    } catch (error) {
      console.error('Failed to update feedback:', error);
    }
  };

  const handleDeleteFeedback = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete Feedback',
      message: 'Are you sure you want to delete this feedback?',
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const response = await apiFetch(`/api/feedback/${id}`, { method: 'DELETE' });
          if (response.ok) {
            setFeedbacks((prev) => prev.filter((feedback) => feedback.id !== id));
          }
        } catch (error) {
          console.error('Failed to delete feedback:', error);
        }
      },
    });
  };

  const openCreateModal = () => {
    setEditingFeedback(null);
    setIsViewMode(false);
    setIsModalOpen(true);
  };

  const openEditModal = (feedback: Feedback, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingFeedback(feedback);
    setIsViewMode(false);
    setIsModalOpen(true);
  };

  const openViewModal = (feedback: Feedback) => {
    setEditingFeedback(feedback);
    setIsViewMode(true);
    setIsModalOpen(true);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1>Vault</h1>
        </div>

        <div className={styles.sectionHeader}>
          <h2>Feedback</h2>
        </div>

        <div className={styles.viewToggle}>
          <div className={styles.carouselPill}>
            <div className={styles.carouselTrack}>
              <div 
                className={styles.carouselItem}
                onClick={() => (window.location.href = '/')}
              >
                <ArrowLeft size={16} />
                <span>Back to Vault</span>
              </div>

              <div className={styles.userMenuWrapper} ref={userMenuRef}>
                <div 
                  className={`${styles.carouselItem} ${isUserMenuOpen ? styles.active : ''}`} 
                  onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  title="Account Menu"
                >
                  <User size={16} />
                  <span>Account</span>
                </div>

                {isUserMenuOpen && (
                  <div className={styles.userMenuDropdown}>
                    <div className={styles.userMenuHeader}>
                      <div className={styles.userMenuAvatar}>
                        <User size={16} />
                      </div>
                      <div className={styles.userMenuPhone}>
                        {currentUser.mobile_number}
                      </div>
                    </div>

                    <div className={styles.userMenuDivider} />

                    <button
                      className={styles.userMenuItem}
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        window.location.href = '/';
                      }}
                    >
                      <ArrowLeft size={16} />
                      <span>Back to Vault</span>
                    </button>

                    <button
                      className={styles.userMenuItem}
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onLogout();
                      }}
                    >
                      <LogOut size={16} />
                      <span>Log Out</span>
                    </button>

                    <button
                      className={`${styles.userMenuItem} ${styles.userMenuItemDanger}`}
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        handleDeleteAccount();
                      }}
                    >
                      <UserX size={16} />
                      <span>Delete Account</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {feedbacks.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No feedback yet.</p>
          <p>Click the + button to create new feedback.</p>
        </div>
      ) : (
        <div className={styles.notesGrid}>
          {feedbacks.map((feedback) => (
            <div
              key={feedback.id}
              className="feedback-card"
              onClick={() => openViewModal(feedback)}
              style={{
                backgroundColor: 'var(--surface-color)',
                borderRadius: '12px',
                padding: '1.25rem',
                border: '1.5px solid rgba(0, 0, 0, 0.08)',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                position: 'relative',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.transform = 'translateY(-2px)';
                event.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.transform = 'none';
                event.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)', fontWeight: 600 }}>
                  {feedback.title}
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={(event) => openEditModal(feedback, event)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      fontSize: '0.8rem',
                      padding: '0.2rem',
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={(event) => handleDeleteFeedback(feedback.id, event)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#ef4444',
                      fontSize: '0.8rem',
                      padding: '0.2rem',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p
                style={{
                  margin: 0,
                  color: 'var(--text-muted)',
                  fontSize: '0.9rem',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {feedback.content}
              </p>
            </div>
          ))}
        </div>
      )}

      <FloatingActionButton onClick={openCreateModal} />

      <FeedbackModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={editingFeedback ? handleUpdateFeedback : handleCreateFeedback}
        initialData={editingFeedback}
        isViewMode={isViewMode}
      />

      <ConfirmModal
        isOpen={confirmModalConfig.isOpen}
        title={confirmModalConfig.title}
        message={confirmModalConfig.message}
        onConfirm={confirmModalConfig.onConfirm}
        onCancel={() => setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }))}
        confirmText="Delete"
      />
    </div>
  );
}

export default FeedbackApp;
