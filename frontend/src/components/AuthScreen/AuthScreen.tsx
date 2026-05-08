import { useEffect, useState } from 'react';
import styles from './AuthScreen.module.css';
import { apiFetch, getErrorMessage, type AuthResponse } from '../../lib/api';

interface AuthScreenProps {
  onAuthenticated: (payload: AuthResponse) => void;
  initialMessage?: string | null;
}

type AuthMode = 'login' | 'signup';
type SignupStep = 'mobile' | 'verify';

export function AuthScreen({ onAuthenticated, initialMessage }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [signupStep, setSignupStep] = useState<SignupStep>('mobile');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(initialMessage ?? null);

  useEffect(() => {
    setSuccess(initialMessage ?? null);
  }, [initialMessage]);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setSignupStep('mobile');
    setOtp('');
    setPassword('');
    setConfirmPassword('');
    resetMessages();
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessages();
    setBusy(true);

    try {
      const response = await apiFetch(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            mobile_number: mobileNumber,
            password,
          }),
        },
        { auth: false },
      );

      if (!response.ok) {
        setError(await getErrorMessage(response, 'Unable to log in.'));
        return;
      }

      const data: AuthResponse = await response.json();
      onAuthenticated(data);
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessages();
    setBusy(true);

    try {
      const response = await apiFetch(
        '/api/auth/send-signup-otp',
        {
          method: 'POST',
          body: JSON.stringify({ mobile_number: mobileNumber }),
        },
        { auth: false },
      );

      if (!response.ok) {
        setError(await getErrorMessage(response, 'Unable to send OTP.'));
        return;
      }

      setSignupStep('verify');
      setSuccess('OTP sent. Enter it below and choose your password.');
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessages();

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const response = await apiFetch(
        '/api/auth/verify-signup-otp',
        {
          method: 'POST',
          body: JSON.stringify({
            mobile_number: mobileNumber,
            otp,
            password,
          }),
        },
        { auth: false },
      );

      if (!response.ok) {
        setError(await getErrorMessage(response, 'Unable to complete signup.'));
        return;
      }

      const data: AuthResponse = await response.json();
      onAuthenticated(data);
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <h1>Vault</h1>
          <p>Secure notes, private canvases, and your own timeline after phone-based login.</p>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
            onClick={() => switchMode('login')}
            type="button"
          >
            Login
          </button>
          <button
            className={`${styles.tab} ${mode === 'signup' ? styles.tabActive : ''}`}
            onClick={() => switchMode('signup')}
            type="button"
          >
            Sign Up
          </button>
        </div>

        {error && <p className={`${styles.message} ${styles.error}`}>{error}</p>}
        {success && <p className={`${styles.message} ${styles.success}`}>{success}</p>}

        {mode === 'login' ? (
          <form className={styles.form} onSubmit={handleLogin}>
            <div className={styles.field}>
              <label htmlFor="login-mobile">Mobile Number</label>
              <input
                id="login-mobile"
                className={styles.input}
                type="tel"
                value={mobileNumber}
                onChange={(event) => setMobileNumber(event.target.value)}
                placeholder="Enter mobile number"
                autoComplete="tel"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className={styles.input}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
              />
            </div>

            <button className={styles.submit} disabled={busy} type="submit">
              {busy ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : signupStep === 'mobile' ? (
          <form className={styles.form} onSubmit={handleSendOtp}>
            <div className={styles.field}>
              <label htmlFor="signup-mobile">Mobile Number</label>
              <input
                id="signup-mobile"
                className={styles.input}
                type="tel"
                value={mobileNumber}
                onChange={(event) => setMobileNumber(event.target.value)}
                placeholder="Enter mobile number"
                autoComplete="tel"
              />
            </div>

            <p className={styles.hint}>We will verify your number with an OTP from 2Factor.in.</p>

            <button className={styles.submit} disabled={busy} type="submit">
              {busy ? 'Sending OTP...' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={handleSignup}>
            <div className={styles.field}>
              <label htmlFor="signup-otp">OTP</label>
              <input
                id="signup-otp"
                className={styles.input}
                type="text"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="Enter OTP"
                autoComplete="one-time-code"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                className={styles.input}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Choose password"
                autoComplete="new-password"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="signup-password-confirm">Confirm Password</label>
              <input
                id="signup-password-confirm"
                className={styles.input}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
              />
            </div>

            <button className={styles.submit} disabled={busy} type="submit">
              {busy ? 'Creating Account...' : 'Verify OTP & Create Account'}
            </button>
            <button className={styles.secondary} onClick={() => setSignupStep('mobile')} type="button">
              Change mobile number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
