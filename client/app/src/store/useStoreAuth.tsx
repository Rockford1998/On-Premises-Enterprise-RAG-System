import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  isActive: boolean;
};

interface UseStoreAuthProps {
  /**
   * Access token. Deliberately NOT persisted — keeping it out of
   * localStorage means an XSS payload cannot read it, and it is short-lived
   * anyway. It is restored on page load by a silent /auth/refresh call, which
   * authenticates via the httpOnly refresh cookie.
   */
  accessToken: string | null;
  userProfile: AuthUser | null;
  /** False until the boot-time refresh attempt has settled. */
  isBootstrapped: boolean;

  setAccessToken: (accessToken: string | null) => void;
  setUserProfile: (userProfile: AuthUser | null) => void;
  setSession: (session: { accessToken: string; user: AuthUser }) => void;
  setBootstrapped: (value: boolean) => void;
  logOut: () => void;
}

export const useStoreAuth = create(
  persist<UseStoreAuthProps>(
    (set) => ({
      accessToken: null,
      userProfile: null,
      isBootstrapped: false,

      setAccessToken: (accessToken) => set(() => ({ accessToken })),
      setUserProfile: (userProfile) => set(() => ({ userProfile })),
      setSession: ({ accessToken, user }) =>
        set(() => ({ accessToken, userProfile: user })),
      setBootstrapped: (isBootstrapped) => set(() => ({ isBootstrapped })),
      logOut: () => set(() => ({ accessToken: null, userProfile: null })),
    }),
    {
      name: "store-auth",
      storage: createJSONStorage(() => localStorage),
      /**
       * Only the profile is persisted, for immediate UI render on reload.
       * The token and the bootstrap flag are intentionally excluded.
       */
      partialize: (state) =>
        ({ userProfile: state.userProfile }) as unknown as UseStoreAuthProps,
    },
  ),
);
