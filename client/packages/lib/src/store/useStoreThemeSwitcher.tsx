import { type PaletteMode } from "@mui/material";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface UseStoreThemeSwitcherProps {
  mode: PaletteMode | undefined;
  setDarkmode: () => void;
  setLightMode: () => void;
  toggleMode: () => void;
}
export const useStoreThemeSwitcher = create(
  persist<UseStoreThemeSwitcherProps>(
    (set, get) => ({
      mode: "light",
      setDarkmode: () => set(() => ({ mode: "dark" })),
      setLightMode: () => set(() => ({ mode: "light" })),
      toggleMode: () =>
        set(() => ({ mode: get().mode === "light" ? "dark" : "light" })),
    }),

    {
      name: "store-themeSwitcher", // unique name
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
    }
  )
);
