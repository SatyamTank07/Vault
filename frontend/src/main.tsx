import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import FeedbackApp from './FeedbackApp.tsx'

const isFeedbackRoute = window.location.pathname === '/feedback' || window.location.pathname === '/feedback/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isFeedbackRoute ? <FeedbackApp /> : <App />}
  </StrictMode>,
)
