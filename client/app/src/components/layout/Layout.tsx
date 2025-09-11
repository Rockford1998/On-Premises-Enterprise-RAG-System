import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet } from "react-router";
import { useState } from "react";
import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { MobileHeader } from "./MobileHeader";
import { WebHeader } from "./WebHeader";

export const Layout = () => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar open={open} setOpen={setOpen} />
        <SidebarInset>
          {isMobile ? (
            <MobileHeader open={open} setOpen={setOpen} />
          ) : (
            <WebHeader />
          )}
          <main className="flex-1 p-4 min-h-screen">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
};
