import { SidebarInset, SidebarProvider } from "@/shadcn/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Header } from "./Header";
import { Outlet } from "react-router";
import { useState } from "react";

export const Layout = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SidebarProvider defaultOpen={open}>
        <AppSidebar open={open} setOpen={setOpen} />
        <SidebarInset>
          <Header />
          <main className="flex-1 px-1 m-1 border-1">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
};
