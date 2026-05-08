import { useCallback, useEffect, useState } from 'react';
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
  const [confirmModalConfig, setConfirmModalConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

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
        <div className={styles.headerTop}>
          <div>
            <h1>Vault Feedback</h1>
            <p>{currentUser.mobile_number}</p>
          </div>
          <div className={styles.viewToggle}>
            <button className={styles.toggleBtn} onClick={() => (window.location.href = '/')} title="Back to Vault">
              Back to App
            </button>
            <button className={styles.toggleBtn} onClick={onLogout} title="Logout">
              Logout
            </button>
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
