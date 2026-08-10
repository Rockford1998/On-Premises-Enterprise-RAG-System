import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { useStoreAuth, type AuthUser } from "@/store/useStoreAuth";

const apiUrl = import.meta.env.VITE_BE_URL;

export const starGate = axios.create({
  baseURL: apiUrl,
  // Required for the httpOnly refresh cookie to be sent to /auth/*.
  withCredentials: true,
});

/** Endpoints that must never trigger the refresh-and-retry loop. */
const AUTH_ENDPOINTS = ["auth/login", "auth/refresh", "auth/logout"];

const isAuthEndpoint = (url?: string) =>
  !!url && AUTH_ENDPOINTS.some((path) => url.includes(path));

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// ---------------------------------------------------------------------------
// Request: attach the in-memory access token.
// ---------------------------------------------------------------------------
starGate.interceptors.request.use(
  (request) => {
    const { accessToken } = useStoreAuth.getState();
    if (accessToken) {
      request.headers.Authorization = `Bearer ${accessToken}`;
    }
    return request;
  },
  (error) => Promise.reject(error),
);

// ---------------------------------------------------------------------------
// Single-flight refresh.
//
// When several requests fail with TOKEN_EXPIRED at once, only the first calls
// /auth/refresh; the rest await the same promise. Without this, N parallel
// 401s would fire N rotations — and since rotation revokes the previous
// token, all but one would come back as reuse detection and log the user out
// during entirely normal use.
// ---------------------------------------------------------------------------
let refreshInFlight: Promise<string | null> | null = null;

const performRefresh = async (): Promise<string | null> => {
  try {
    // Bare axios, not starGate: bypasses these interceptors so a failing
    // refresh cannot recurse into itself.
    const { data } = await axios.post(
      `${apiUrl}auth/refresh`,
      {},
      { withCredentials: true },
    );

    const accessToken: string | undefined = data?.data?.accessToken;
    const user: AuthUser | undefined = data?.data?.user;

    if (!accessToken) return null;

    if (user) {
      useStoreAuth.getState().setSession({ accessToken, user });
    } else {
      useStoreAuth.getState().setAccessToken(accessToken);
    }
    return accessToken;
  } catch {
    return null;
  }
};

/** Refresh the session, coalescing concurrent callers onto one request. */
export const refreshSession = (): Promise<string | null> => {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};

const redirectToSignIn = () => {
  useStoreAuth.getState().logOut();
  if (!window.location.pathname.startsWith("/sign-in")) {
    window.location.href = "/sign-in";
  }
};

// ---------------------------------------------------------------------------
// Response: on an expired access token, refresh once and replay the request.
// ---------------------------------------------------------------------------
starGate.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ code?: string; message?: string }>) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const code = error.response?.data?.code;

    if (status !== 401) {
      return Promise.reject(error);
    }

    // A 401 from an auth endpoint, or a repeat failure after we already
    // retried, means the session is genuinely gone.
    if (!original || original._retried || isAuthEndpoint(original.url)) {
      if (original && !isAuthEndpoint(original.url)) {
        redirectToSignIn();
      }
      return Promise.reject(error);
    }

    // Only an expired (or absent) access token is recoverable by refreshing.
    if (code && code !== "TOKEN_EXPIRED" && code !== "TOKEN_MISSING") {
      redirectToSignIn();
      return Promise.reject(error);
    }

    original._retried = true;

    const newToken = await refreshSession();
    if (!newToken) {
      redirectToSignIn();
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${newToken}`;
    return starGate(original as AxiosRequestConfig);
  },
);

/**
 * Restore the session on app start. The access token lives in memory and so
 * is lost on reload, but the httpOnly refresh cookie survives — one silent
 * refresh re-establishes the session.
 */
export const bootstrapSession = async (): Promise<void> => {
  try {
    await refreshSession();
  } finally {
    useStoreAuth.getState().setBootstrapped(true);
  }
};
