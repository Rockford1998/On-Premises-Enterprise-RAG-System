import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { ProtectedRoute } from "./-component/ProtectedRoute";
import { AppSidebar } from "../-components/layout/AppSidebar";
import { MobileHeader } from "../-components/layout/MobileHeader";

export const Route = createFileRoute("/(app)")({
  component: RouteComponent,
  // `location` here is the router's location, not window.location.
  beforeLoad: ({ location }) => ProtectedRoute({ location }),
});

function RouteComponent() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar open={open} setOpen={setOpen} />
        <SidebarInset>
          {isMobile ? <MobileHeader open={open} setOpen={setOpen} /> : null}
          <main className="px-4">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>{" "}
    </>
  );
}

