import { Bot, Computer, Home } from "lucide-react";

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
import { Link } from "@tanstack/react-router";
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
];

export function AppSidebar({
  setOpen,
  open,
}: {
  setOpen: (open: boolean) => void;
  open: boolean;
}) {
  const isMobile = useIsMobile();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarHeader className="flex flex-row justify-between">
          {open === true && (
            <div>
              <h3>Lamma RAG</h3>
            </div>
          )}
          <div>
            {!isMobile && (
              <SidebarTrigger
                onClick={() => setOpen(!open)}
                className="cursor-pointer"
              />
            )}
          </div>
        </SidebarHeader>
        <SidebarGroup>
          <SidebarGroupContent>
            <Separator />
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
