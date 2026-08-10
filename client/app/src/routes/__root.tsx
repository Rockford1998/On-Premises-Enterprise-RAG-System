import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <Outlet />
      {/* Mounted at the root so the auth pages, which sit outside the app
          shell, can raise toasts too. */}
      <Toaster />
    </>
  );
}
