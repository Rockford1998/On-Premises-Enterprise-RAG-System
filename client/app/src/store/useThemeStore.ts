import { create } from "zustand";
import { persist } from "zustand/middleware";
export type Theme = "dark" | "light" | "system";

type ThemeState = {
  theme: Theme;
  setLightTheme: () => void;
  setDarkTheme: () => void;
  setSystemTheme: () => void;

};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      setDarkTheme: () => set({ theme: "dark" }),
      setLightTheme: () => set({ theme: "light" }),
      setSystemTheme: () => set({ theme: "system" }),
    }),
    {
      name: "theme-storage",
    }
  )
);
