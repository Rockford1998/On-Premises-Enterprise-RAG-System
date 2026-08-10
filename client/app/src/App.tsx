import {
  createRouter,
  RouterProvider,
  type RegisteredRouter,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { routeTree } from "./routeTree.gen";
import { bootstrapSession } from "./utils/starGate";

const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const App = () => {
  const [isReady, setIsReady] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode double-invokes effects in dev; guard so the refresh (which
    // rotates the token) only runs once.
    if (started.current) return;
    started.current = true;

    // Attempt a silent refresh before the router evaluates any beforeLoad
    // guard. The access token is memory-only, so after a reload the session
    // exists only in the httpOnly cookie until this resolves.
    void bootstrapSession().finally(() => setIsReady(true));
  }, []);

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return <RouterProvider router={router} />;
};

export type RoutePaths = keyof RegisteredRouter["routesByPath"];
export default App;
