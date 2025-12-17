import { AppSidebar } from "@/components/layout/AppSidebar";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { Toaster } from "sonner";
import { ProtectedRoute } from "./-component/ProtectedRoute";

export const Route = createFileRoute("/(app)")({
  component: RouteComponent,
  beforeLoad: () => ProtectedRoute({ location }),
});

function RouteComponent() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar open={open} setOpen={setOpen} />
        <Toaster />
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

