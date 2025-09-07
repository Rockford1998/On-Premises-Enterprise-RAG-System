import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet } from "react-router";
import { useState } from "react";

export const Layout = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar open={open} setOpen={setOpen} />

        <SidebarInset>
          <main className="flex-1 p-4 min-h-screen">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
};
