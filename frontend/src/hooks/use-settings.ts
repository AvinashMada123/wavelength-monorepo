"use client";

import { useSettingsContext } from "@/context/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { AppSettings } from "@/types/settings";

export function useSettings() {
  const { state, dispatch } = useSettingsContext();

  return {
    settings: state.settings,
    loaded: state.loaded,

    updateSettings: (updates: Partial<AppSettings>) => {
      dispatch({ type: "UPDATE_SETTINGS", payload: updates });
    },

    resetToDefaults: () => {
      dispatch({ type: "RESET" });
    },
  };
}
