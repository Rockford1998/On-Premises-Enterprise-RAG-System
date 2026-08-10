import { jwtDecode } from "jwt-decode";

/**
 * True when the token is present and has not expired.
 *
 * `exp` is in SECONDS since the epoch while Date.now() is in milliseconds;
 * comparing them directly (as an earlier version did) makes every token look
 * valid for the next several millennia.
 */
export const isAccessTokenValid = (
  token: string | null | undefined,
): boolean => {
  if (!token) return false;
  try {
    const { exp } = jwtDecode<{ exp?: number }>(token);
    if (!exp) return false;
    // Small skew allowance so a token that is about to lapse counts as stale
    // and gets refreshed proactively rather than failing mid-request.
    const skewSeconds = 5;
    return exp - skewSeconds > Date.now() / 1000;
  } catch {
    return false;
  }
};
