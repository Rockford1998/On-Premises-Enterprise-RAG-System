import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet } from "react-router";
import { useState } from "react";
import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { MobileHeader } from "./MobileHeader";
import { Toaster } from "@/shadcn/ui/sonner";

export const Layout = () => {
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
      </SidebarProvider>
    </>
  );
};
