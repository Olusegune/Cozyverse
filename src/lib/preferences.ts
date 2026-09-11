// App-wide preferences that outlive a single session, stored in localStorage
// (not per-project — these describe how you like to work, not the project).

import { useState } from "react";

const RENDER_MODE_KEY = "cozyverse-default-render-mode";

/** Every studio (Image/Motion/Audio) has its own local Mock/Auto toggle that
 * used to reset to Mock on every visit. This is the shared default: once you
 * pick Auto anywhere, new studio sessions start on Auto too. Each studio still
 * owns its own toggle state during a session — this only seeds the initial
 * value and remembers the last choice. */
export function getDefaultRenderMode(): boolean {
  try {
    return localStorage.getItem(RENDER_MODE_KEY) === "auto";
  } catch {
    return false;
  }
}

export function setDefaultRenderMode(useReal: boolean) {
  try {
    localStorage.setItem(RENDER_MODE_KEY, useReal ? "auto" : "mock");
  } catch {
    /* private-browsing / storage disabled — the toggle still works, it just won't persist */
  }
}

/** Drop-in replacement for `useState(false)` on a studio's Mock/Auto toggle —
 * same shape, but seeded from (and written back to) the shared preference. */
export function useRenderModePref(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(getDefaultRenderMode);
  const set = (next: boolean) => {
    setValue(next);
    setDefaultRenderMode(next);
  };
  return [value, set];
}
