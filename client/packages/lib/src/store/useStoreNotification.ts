import { type AlertProps } from "@mui/material";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
interface useStoreNotificationProps {
  open: boolean;
  level: AlertProps["severity"];
  message: React.ReactNode;
  notifySuccess: (message: React.ReactNode) => void;
  notifyError: (message: React.ReactNode) => void;
  notifyWarning: (message: React.ReactNode) => void;
  notifyInfo: (message: React.ReactNode) => void;
  handleClose: () => void;
}

export const useStoreNotification = create(
  persist<useStoreNotificationProps>(
    (set) => ({
      open: false,
      message: "",
      level: "success",

      //
      notifySuccess: (message: React.ReactNode) =>
        set({
          level: "success",
          open: true,
          message,
        }),

      //
      notifyError: (message: React.ReactNode) =>
        set({
          level: "error",
          open: true,
          message,
        }),

      //
      notifyWarning: (message: React.ReactNode) =>
        set({
          level: "warning",
          open: true,
          message,
        }),

      //
      notifyInfo: (message: React.ReactNode) =>
        set({
          level: "info",
          open: true,
          message,
        }),

      //
      handleClose: () => set(() => ({ open: false, message: "" })),
    }),
    {
      name: "store-notificaion",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
