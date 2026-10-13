import { normalizeStatus } from '../../lib/noteText';
import ui from './ui.module.css';

/** The ui.module.css class carrying a status's fg/bg/border colors (s_todo, s_in_progress, s_done). */
export const statusClass = (status: string | null | undefined): string => ui[`s_${normalizeStatus(status)}`];
