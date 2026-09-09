import { Bot, Computer, Home, Server } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/shadcn/ui/sidebar";
import { NavUser } from "../nav/NavUser";
import { Separator } from "@/shadcn/ui/separator";
import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { Link, useRouterState } from "@tanstack/react-router";
import type { RoutePaths } from "@/App";

const user = {
  name: "shadcn",
  email: "m@example.com",
  avatar: "/avatars/shadcn.jpg",
};

type NavItem = {
  title: string;
  to: RoutePaths;
  icon: React.ComponentType;
};

const items: NavItem[] = [
  { title: "Home", to: "/", icon: Home },
  { title: "Hub", to: "/hub-overview", icon: Computer },
  { title: "Agents", to: "/agent-overview", icon: Bot },
  { title: "LLM Models", to: "/llm-overview", icon: Server },
];

export function AppSidebar({
  setOpen,
  open,
}: {
  setOpen: (open: boolean) => void;
  open: boolean;
}) {
  const isMobile = useIsMobile();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarHeader className="flex h-12 flex-row items-center justify-between px-2">
          {open && (
            <span className="font-serif text-sm font-semibold tracking-tight">
              Lamma RAG
            </span>
          )}
          {!isMobile && (
            <SidebarTrigger
              onClick={() => setOpen(!open)}
              className="ml-auto cursor-pointer"
            />
          )}
        </SidebarHeader>
        <Separator />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive =
                  item.to === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
