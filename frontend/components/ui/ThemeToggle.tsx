'use client';

import { useEffect, useState } from 'react';

/**
 * DARK / LIGHT / SYSTEM.
 *
 * Dark is the default — this is a tool people stare at for hours, and it is what
 * the team asked for. Light and "match my system" are one click away.
 *
 * The choice lives on <html data-theme> and in localStorage, applied by a
 * blocking script in layout.tsx BEFORE first paint. Without that, a light-theme
 * user would see a dark flash on every load.
 */

export type Theme = 'light' | 'dark' | 'system';

export const THEME_KEY = 'aitest.theme';

/**
 * Runs in <head> before paint. Kept as a string because it must execute before
 * React hydrates — otherwise the page flashes the wrong colours.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('${THEME_KEY}') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  // Transitions are enabled only after the first paint, so the initial render
  // does not animate from one theme to the other.
  requestAnimationFrame(function () {
    document.documentElement.classList.add('theme-ready');
  });
})();
`;

// Dark first: it is the default, so it reads left-to-right as the primary choice.
const OPTIONS: Array<{ value: Theme; label: string; icon: string }> = [
  { value: 'dark', label: 'Dark', icon: '☾' },
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'system', label: 'Match my system', icon: '⌘' },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  // Read what the init script already applied, rather than assuming a default.
  useEffect(() => {
    const current = (document.documentElement.getAttribute('data-theme') as Theme) || 'dark';
    setTheme(current);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private browsing — the choice just will not persist */
    }
  };

  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => choose(o.value)}
          aria-pressed={theme === o.value}
          aria-label={o.label}
          title={o.label}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
