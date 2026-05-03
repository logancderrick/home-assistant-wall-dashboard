/**
 * Hides the Home Assistant sidebar and panel header from within the Skydark
 * iframe panel — without breaking voice satellite or other HA-level dialogs.
 *
 * Uses injected <style> tags inside shadow roots rather than fragile inline
 * style snapshots, so toggling survives HA component re-renders.  A
 * MutationObserver re-injects the styles if HA's renderer removes them.
 */

// ── Module state ──────────────────────────────────────────────────────────────
let _hidden = false;
let _userExplicit = false;
let _mainObserver: MutationObserver | null = null;
let _panelObserver: MutationObserver | null = null;
let _panelRetryTimer: number | null = null;
const _listeners = new Set<(hidden: boolean) => void>();

const MAIN_STYLE_ID = "skydark-hide-main-chrome";
const PANEL_STYLE_ID = "skydark-hide-panel-chrome";
const VS_STYLE_ID = "skydark-vs-overlay-fix";

const HIDE_MAIN_CSS = `
  ha-sidebar {
    width: 0 !important;
    min-width: 0 !important;
    overflow: hidden !important;
    visibility: hidden !important;
  }
  ha-drawer {
    --mdc-drawer-width: 0px !important;
  }
`;

const HIDE_PANEL_CSS = `
  app-header {
    display: none !important;
  }
  #contentContainer, .content {
    padding-top: 0 !important;
  }
`;

// Voice Satellite (jxlarrea/voice-satellite-card-integration) appends its
// overlay div to the parent frame's document.body. When Skydark is a
// fullscreen iframe the overlay renders behind the iframe and is invisible.
// Boosting its z-index here ensures it stacks above the iframe when triggered.
const VS_OVERLAY_CSS = `
  #voice-satellite-ui {
    z-index: 2147483647 !important;
  }
`;

// ── Subscription ──────────────────────────────────────────────────────────────

/** Subscribe to hidden-state changes. Returns an unsubscribe function. */
export function onHaChromeStateChange(fn: (hidden: boolean) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function isHaChromeHidden(): boolean {
  return _hidden;
}

// ── Voice Satellite overlay fix ───────────────────────────────────────────────

function injectVsOverlayFix() {
  try {
    const parentDoc = window.parent.document;
    if (parentDoc.getElementById(VS_STYLE_ID)) return;
    const style = parentDoc.createElement("style");
    style.id = VS_STYLE_ID;
    style.textContent = VS_OVERLAY_CSS;
    parentDoc.head.appendChild(style);
  } catch {
    // cross-origin or not in iframe
  }
}

// ── Shadow root helpers ───────────────────────────────────────────────────────

function getHaMainShadow(): ShadowRoot | null {
  try {
    const ha = window.parent.document.querySelector("home-assistant");
    const haMain = ha?.shadowRoot?.querySelector("home-assistant-main");
    return (haMain as Element | undefined)?.shadowRoot ?? null;
  } catch {
    return null;
  }
}

function getPanelShadow(): ShadowRoot | null {
  try {
    const mainShadow = getHaMainShadow();
    if (!mainShadow) return null;
    const drawer = mainShadow.querySelector("ha-drawer");
    const resolver = drawer?.querySelector("partial-panel-resolver");
    const panel = resolver?.querySelector("ha-panel-iframe");
    return (panel as Element | undefined)?.shadowRoot ?? null;
  } catch {
    return null;
  }
}

function upsertStyle(shadowRoot: ShadowRoot | null, id: string, css: string) {
  if (!shadowRoot) return;
  let el = shadowRoot.querySelector(`#${id}`) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style") as HTMLStyleElement;
    el.id = id;
    shadowRoot.appendChild(el);
  }
  el.textContent = css;
}

function removeStyle(shadowRoot: ShadowRoot | null, id: string) {
  shadowRoot?.querySelector(`#${id}`)?.remove();
}

// ── Apply / remove ────────────────────────────────────────────────────────────

function applyHideStyles() {
  upsertStyle(getHaMainShadow(), MAIN_STYLE_ID, HIDE_MAIN_CSS);
  upsertStyle(getPanelShadow(), PANEL_STYLE_ID, HIDE_PANEL_CSS);
}

function removeHideStyles() {
  removeStyle(getHaMainShadow(), MAIN_STYLE_ID);
  removeStyle(getPanelShadow(), PANEL_STYLE_ID);
}

// ── MutationObservers — re-inject styles if HA removes them ─────────────────

function startObservers() {
  if (window.parent === window) return;

  const mainShadow = getHaMainShadow();
  if (mainShadow && !_mainObserver) {
    _mainObserver = new MutationObserver(() => {
      if (_hidden && !mainShadow.querySelector(`#${MAIN_STYLE_ID}`)) {
        applyHideStyles();
      }
    });
    _mainObserver.observe(mainShadow, { childList: true, subtree: true });
  }

  // Panel shadow only exists once HA has resolved the iframe panel. It can also
  // get re-rendered when navigating between HA pages, so observe + retry until
  // we have a panel root and the style tag is present.
  attachPanelObserver();
  schedulePanelRetry();
}

function attachPanelObserver() {
  if (_panelObserver) return;
  const panelShadow = getPanelShadow();
  if (!panelShadow) return;

  _panelObserver = new MutationObserver(() => {
    if (_hidden && !panelShadow.querySelector(`#${PANEL_STYLE_ID}`)) {
      upsertStyle(panelShadow, PANEL_STYLE_ID, HIDE_PANEL_CSS);
    }
  });
  _panelObserver.observe(panelShadow, { childList: true, subtree: true });
}

function schedulePanelRetry() {
  if (_panelRetryTimer != null) return;
  let attempts = 0;
  _panelRetryTimer = window.setInterval(() => {
    attempts++;
    if (!_hidden || attempts > 30) {
      clearPanelRetry();
      return;
    }
    if (!_panelObserver) {
      attachPanelObserver();
    }
    const panelShadow = getPanelShadow();
    if (panelShadow && !panelShadow.querySelector(`#${PANEL_STYLE_ID}`)) {
      upsertStyle(panelShadow, PANEL_STYLE_ID, HIDE_PANEL_CSS);
    }
    if (panelShadow && _panelObserver) {
      clearPanelRetry();
    }
  }, 500);
}

function clearPanelRetry() {
  if (_panelRetryTimer != null) {
    window.clearInterval(_panelRetryTimer);
    _panelRetryTimer = null;
  }
}

function stopObservers() {
  _mainObserver?.disconnect();
  _mainObserver = null;
  _panelObserver?.disconnect();
  _panelObserver = null;
  clearPanelRetry();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function hideHaChrome() {
  _hidden = true;
  applyHideStyles();
  startObservers();
  for (const fn of _listeners) fn(_hidden);
}

export function showHaChrome() {
  _hidden = false;
  removeHideStyles();
  stopObservers();
  for (const fn of _listeners) fn(_hidden);
}

export function toggleHaChrome() {
  _userExplicit = true;
  if (_hidden) {
    showHaChrome();
  } else {
    hideHaChrome();
  }
}

/**
 * Retries hideHaChrome() until the HA shadow DOM is ready.
 * Bails out if the user has already explicitly toggled visibility, so
 * the auto-hide retry never overrides a deliberate "show" click that
 * happened during HA's initial render.
 *
 * Returns a cleanup function.
 */
export function hideHaChromeWhenReady(
  maxAttempts = 20,
  intervalMs = 300,
): () => void {
  if (window.parent === window) return () => {};

  // Apply the VS overlay z-index fix immediately — it is safe to inject before
  // HA's shadow DOM is ready because it targets document.head, not a shadow root.
  injectVsOverlayFix();

  let attempts = 0;

  const id = window.setInterval(() => {
    attempts++;
    if (_userExplicit) {
      window.clearInterval(id);
      return;
    }
    const mainShadow = getHaMainShadow();
    if (mainShadow) {
      window.clearInterval(id);
      if (!_userExplicit) hideHaChrome();
      return;
    }
    if (attempts >= maxAttempts) window.clearInterval(id);
  }, intervalMs);

  return () => {
    window.clearInterval(id);
    showHaChrome();
  };
}
