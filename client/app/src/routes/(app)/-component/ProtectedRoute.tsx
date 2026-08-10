import { redirect } from "@tanstack/react-router";
import { useStoreAuth } from "@/store/useStoreAuth";
import { isAccessTokenValid } from "@/utils/verifyAccessToken";
import { refreshSession } from "@/utils/starGate";

/**
 * Route guard for the authenticated shell.
 *
 * App already attempts a silent refresh on boot, so a missing token here
 * usually means there is no session at all. The second refresh attempt covers
 * the case where the access token lapsed while the tab sat idle — the
 * httpOnly refresh cookie may still be valid.
 */
export const ProtectedRoute = async ({ location }: any) => {
  const { accessToken, logOut } = useStoreAuth.getState();

  if (isAccessTokenValid(accessToken)) {
    return;
  }

  const refreshed = await refreshSession();
  if (isAccessTokenValid(refreshed)) {
    return;
  }

  logOut();
  throw redirect({
    to: "/sign-in",
    search: { redirect: location?.href },
  });
};
