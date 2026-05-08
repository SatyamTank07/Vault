import { useEffect, useState } from 'react';
import App from './App';
import FeedbackApp from './FeedbackApp';
import { AuthScreen } from './components/AuthScreen/AuthScreen';
import {
  apiFetch,
  clearAuthToken,
  getAuthToken,
  setAuthToken,
  UNAUTHORIZED_EVENT,
  type AuthResponse,
  type CurrentUser,
} from './lib/api';

export default function Root() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearAuthToken();
      setCurrentUser(null);
      setAuthMessage('Your session expired. Please log in again.');
    };

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      const token = getAuthToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await apiFetch('/api/auth/me', { method: 'GET' }, { suppressUnauthorizedEvent: true });
        if (!response.ok) {
          clearAuthToken();
          setLoading(false);
          return;
        }

        const user: CurrentUser = await response.json();
        setCurrentUser(user);
      } catch {
        clearAuthToken();
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const handleAuthenticated = (payload: AuthResponse) => {
    setAuthToken(payload.access_token);
    setCurrentUser(payload.user);
    setAuthMessage(null);
  };

  const handleLogout = () => {
    clearAuthToken();
    setCurrentUser(null);
    setAuthMessage(null);
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={handleAuthenticated} initialMessage={authMessage} />;
  }

  const isFeedbackRoute = window.location.pathname === '/feedback' || window.location.pathname === '/feedback/';
  return isFeedbackRoute ? (
    <FeedbackApp currentUser={currentUser} onLogout={handleLogout} />
  ) : (
    <App currentUser={currentUser} onLogout={handleLogout} />
  );
}
