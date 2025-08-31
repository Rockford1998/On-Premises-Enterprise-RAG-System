import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

//
interface UseStoreAuthProps {
  accessToken: string | null;
  setAccessToken: (accessToken: UseStoreAuthProps["accessToken"]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userProfile: any;
  setActions: (payload: UseStoreAuthProps["userProfile"]) => void;
  setAccessTokenAndPayload: (
    accessToken: UseStoreAuthProps["accessToken"],
    actions: UseStoreAuthProps["userProfile"]
  ) => void;
  logOut: () => void;
}

//
export const useStoreAuth = create(
  persist<UseStoreAuthProps>(
    (set) => ({
      accessToken: null,
      setAccessToken: (accessToken) => set(() => ({ accessToken })),
      userProfile: null,
      setActions: (userProfile) => set(() => ({ userProfile })),
      setAccessTokenAndPayload: (accessToken, userProfile) =>
        set(() => ({ accessToken, userProfile })),
      logOut: () => set(() => ({ accessToken: null, payload: null })),
    }),
    {
      name: "store-auth", // unique name
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
    }
  )
);
