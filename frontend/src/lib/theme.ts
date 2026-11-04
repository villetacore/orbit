export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'orbit-theme';

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

// applyTheme sets <html data-theme>; the design system's "auto" follows the OS.
export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice === 'system' ? 'auto' : choice;
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage may be unavailable (private mode); the choice still applies now.
  }
  applyTheme(choice);
}
