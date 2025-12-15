import * as React from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { useState } from "react";
import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { Toaster } from "@/shadcn/ui/sonner";
import { MobileHeader } from "@/components/layout/MobileHeader";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <React.Fragment>
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
    </React.Fragment>
  );
}

