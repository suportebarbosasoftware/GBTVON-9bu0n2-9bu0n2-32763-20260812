/** Directional focus support for the webOS browser. */
import { useEffect } from 'react';
import { router } from 'expo-router';

type Direction = 'left' | 'right' | 'up' | 'down';

function focusableElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="button"], button, input, [tabindex="0"]'))
    .filter(element => {
      const style = window.getComputedStyle(element);
      return !element.hasAttribute('disabled') && style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
    });
}

function closestInDirection(current: HTMLElement, direction: Direction, candidates: HTMLElement[]): HTMLElement | null {
  const source = current.getBoundingClientRect();
  const sourceX = source.left + source.width / 2;
  const sourceY = source.top + source.height / 2;
  const horizontal = direction === 'left' || direction === 'right';
  const matchesLane = (rect: DOMRect) => horizontal
    ? rect.bottom > source.top + 6 && rect.top < source.bottom - 6
    : rect.right > source.left + 6 && rect.left < source.right - 6;
  const directional = candidates.filter(candidate => {
    if (candidate === current) return false;
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = direction === 'left' ? sourceX - x : direction === 'right' ? x - sourceX : direction === 'up' ? sourceY - y : y - sourceY;
    return primary > 1;
  });
  // Remain in the current row/column whenever there is a suitable target.
  // When moving between the sidebar and the screen content there may be no
  // aligned target, so fall back to the closest directional control instead
  // of trapping focus on the sidebar.
  const sameLane = directional.filter(candidate => matchesLane(candidate.getBoundingClientRect()));
  const eligible = sameLane.length ? sameLane : directional;
  let winner: HTMLElement | null = null;
  let winnerScore = Number.POSITIVE_INFINITY;

  for (const candidate of eligible) {
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = direction === 'left' ? sourceX - x : direction === 'right' ? x - sourceX : direction === 'up' ? sourceY - y : y - sourceY;
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(y - sourceY) : Math.abs(x - sourceX);
    // Candidates must share the same visual row/column. Within that lane,
    // preserving alignment matters more than selecting a nearby control in a
    // different row, which made Left/Right feel like Down on the TV.
    const score = primary + secondary * 4;
    if (score < winnerScore) { winner = candidate; winnerScore = score; }
  }
  return winner;
}

export default function WebOSRemoteNavigation() {
  useEffect(() => {
    // NetCast 2.0 (older LG Smart TVs) exposes a system API that turns off
    // its virtual mouse. It is unavailable on current webOS and in ordinary
    // browsers, so guard it carefully and retain normal web behavior there.
    const legacyTV = window as Window & { NetCastMouseOff?: (seconds: number) => void };
    const hideLegacyPointer = () => {
      try {
        legacyTV.NetCastMouseOff?.(1);
      } catch {
        // The built-in browser can expose a partial API on some TV models.
      }
    };
    hideLegacyPointer();
    window.addEventListener('mouseon', hideLegacyPointer as EventListener);

    const focusStyle = document.createElement('style');
    focusStyle.textContent = [
      // 1.40 is large enough to be read comfortably from a sofa while still
      // keeping the movie and series carousels visible on 1080p panels.
      '@media (min-width: 1200px) { body { zoom: 1.4; } }',
      // A Magic Remote exposes a floating mouse pointer in the LG browser.
      // This is a TV interface: navigation is deliberately D-pad/OK only.
      'html, body, body * { cursor: none !important; }',
      // The catalog keyboard uses a dense layout on the web version. The
      // global TV zoom keeps regular UI legible from a sofa, but would make
      // this modal unnecessarily dominate the whole screen.
      '[data-testid="catalog-keyboard-dialog"] { width: min(560px, 84vw) !important; max-width: 560px !important; padding: 12px !important; }',
      '[data-testid^="catalog-key-"] { width: 38px !important; height: 30px !important; min-width: 38px !important; border-radius: 6px !important; }',
      '[data-testid^="catalog-action-"] { height: 34px !important; min-width: 46px !important; border-radius: 7px !important; }',
      '[role="button"]:focus, button:focus, input:focus, [tabindex="0"]:focus {',
      'outline: 5px solid #ffd700 !important;',
      'outline-offset: 5px;',
      'filter: brightness(1.18);',
      '}',
    ].join('');
    document.head.appendChild(focusStyle);

    const initialFocus = window.setTimeout(() => {
      if (document.activeElement === document.body) focusableElements()[0]?.focus();
    }, 250);

    let enterTimer: ReturnType<typeof setTimeout> | null = null;
    let enterTarget: HTMLElement | null = null;
    let longPressFired = false;

    const onKeyDown = (event: KeyboardEvent) => {
      // The player owns media keys and directional seeking.
      if (document.querySelector('video')) return;
      if (event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'Backspace' || event.keyCode === 461) {
        event.preventDefault();
        // Acceptance is mandatory; the Back key must not navigate the hidden
        // screen behind its modal.
        if (document.querySelector('[data-testid="terms-gate"]')) return;
        router.back();
        return;
      }
      const direction: Record<string | number, Direction | undefined> = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
        37: 'left', 39: 'right', 38: 'up', 40: 'down',
      };
      const requested = direction[event.key] ?? direction[event.keyCode];
      const candidates = focusableElements();
      if (requested) {
        event.preventDefault();
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const activeTestId = active?.getAttribute('data-testid') || '';
        const focusByTestId = (testID: string) => document.querySelector<HTMLElement>(`[data-testid="${testID}"]`)?.focus();
        // Login is a fixed three-step flow on TV. Do not let browser geometry
        // send focus back to the name field or straight to an unrelated link.
        if (requested === 'down' && activeTestId === 'login-name-field') { focusByTestId('login-rep-field'); return; }
        if (requested === 'up' && activeTestId === 'login-rep-field') { focusByTestId('login-name-field'); return; }
        if (requested === 'down' && activeTestId === 'login-rep-field') { focusByTestId('login-submit'); return; }
        if (requested === 'up' && activeTestId === 'login-submit') { focusByTestId('login-rep-field'); return; }
        // A category is immediately below the search field. Its cards and
        // top tabs can be visually closer than the search control, so the
        // generic geometry picker used to skip it. Make this TV path explicit.
        if (requested === 'up' && activeTestId.startsWith('catalog-category-')) {
          const search = document.querySelector<HTMLElement>('[data-testid="catalog-search-trigger"]');
          if (search) { search.focus(); search.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
        }
        const next = active ? closestInDirection(active, requested, candidates) : candidates[0];
        next?.focus();
        next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ' || event.keyCode === 13) && document.activeElement instanceof HTMLElement && candidates.includes(document.activeElement)) {
        event.preventDefault();
        if (event.repeat || enterTimer) return;
        enterTarget = document.activeElement;
        longPressFired = false;
        enterTimer = setTimeout(() => {
          enterTimer = null;
          longPressFired = true;
          const handler = (enterTarget as any)?.__webosLongPress as (() => void) | undefined;
          if (handler) handler();
          else enterTarget?.dispatchEvent(new Event('webos-longpress', { bubbles: true }));
        }, 550);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!(event.key === 'Enter' || event.key === ' ' || event.keyCode === 13)) return;
      event.preventDefault();
      if (enterTimer) clearTimeout(enterTimer);
      enterTimer = null;
      const target = enterTarget;
      enterTarget = null;
      if (target && !longPressFired) target.click();
      longPressFired = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mouseon', hideLegacyPointer as EventListener);
      if (enterTimer) clearTimeout(enterTimer);
      focusStyle.remove();
      window.clearTimeout(initialFocus);
    };
  }, []);
  return null;
}
