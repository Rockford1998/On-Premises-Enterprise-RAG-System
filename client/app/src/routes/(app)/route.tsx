import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { ProtectedRoute } from "./-component/ProtectedRoute";
import { AppSidebar } from "../-components/layout/AppSidebar";
import { MobileHeader } from "../-components/layout/MobileHeader";
import { DesktopHeader } from "../-components/layout/DesktopHeader";

export const Route = createFileRoute("/(app)")({
  component: RouteComponent,
  // `location` here is the router's location, not window.location.
  beforeLoad: ({ location }) => ProtectedRoute({ location }),
});

function RouteComponent() {
  // Desktop opens with the sidebar expanded; mobile always starts collapsed
  // (it renders as an offcanvas sheet, not inline, so "open" has no layout cost there).
  const [open, setOpen] = useState(true);
  const isMobile = useIsMobile();

  return (
    <SidebarProvider open={isMobile ? undefined : open} onOpenChange={setOpen}>
      <AppSidebar open={open} setOpen={setOpen} />
      <SidebarInset>
        {isMobile ? (
          <MobileHeader open={open} setOpen={setOpen} />
        ) : (
          <DesktopHeader />
        )}
        <main className="flex-1 px-4 py-4 md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

