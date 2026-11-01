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

// applyTheme sets <html data-theme>; "system" removes it so the
// prefers-color-scheme media query decides.
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
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
