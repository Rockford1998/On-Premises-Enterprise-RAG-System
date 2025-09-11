import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

//
interface UseStoreAuthProps {
  accessToken: string | null;
  userProfile: any;
  setAccessToken: (accessToken: UseStoreAuthProps["accessToken"]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logOut: () => void;
}

//
export const useStoreAuth = create(
  persist<UseStoreAuthProps>(
    (set) => ({
      accessToken: null,
      setAccessToken: (accessToken) => set(() => ({ accessToken })),
      userProfile: null,
      logOut: () => set(() => ({ accessToken: null, userProfile: null })),
    }),
    {
      name: "store-auth", // unique name
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
    }
  )
);
