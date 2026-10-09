// Display helpers: GUI scale (CSS zoom on the HUD and menus) and fullscreen.

let guiSetting = 0;

// Auto scale fits the hotbar to the window width and the inventory to its
// height: 1.0 at 1280x720, 1.5 at 1080p, ~0.85 on a portrait phone.
export function autoGuiScale(w = window.innerWidth, h = window.innerHeight) {
  return Math.max(0.6, Math.min(2, (w - 16) / 440, h / 720));
}

export function currentGuiScale() {
  return guiSetting > 0 ? guiSetting : autoGuiScale();
}

export function applyGuiScale(setting) {
  guiSetting = setting;
  document.documentElement.style.setProperty('--gui', currentGuiScale().toFixed(3));
}

window.addEventListener('resize', () => applyGuiScale(guiSetting));

export function isFullscreen() {
  return !!document.fullscreenElement;
}

export async function setFullscreen(on) {
  try {
    if (on && !isFullscreen()) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      // In fullscreen, Chrome lets the page claim browser shortcuts such as
      // Ctrl+W (sprint + forward). Esc must then be held to leave fullscreen.
      await navigator.keyboard?.lock?.().catch(() => {});
    } else if (!on && isFullscreen()) {
      navigator.keyboard?.unlock?.();
      await document.exitFullscreen();
    }
  } catch {
    // not allowed (e.g. iOS Safari, or no user gesture) — leave it be
  }
  return isFullscreen();
}

export function fullscreenSupported() {
  return !!document.documentElement.requestFullscreen;
}
