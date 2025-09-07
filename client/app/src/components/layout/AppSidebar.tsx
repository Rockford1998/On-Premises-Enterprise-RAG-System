import { Home, Settings } from "lucide-react";

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
import { Link } from "react-router";

const user = {
  name: "shadcn",
  email: "m@example.com",
  avatar: "/avatars/shadcn.jpg",
};

// Menu items.
const items = [
  {
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Settings",
    url: "/Settings",
    icon: Settings,
  },
];

export function AppSidebar({
  setOpen,
  open,
}: {
  setOpen: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarHeader className="flex flex-row justify-between">
          {open === true && (
            <div>
              <h1>Mark</h1>
            </div>
          )}
          <div>
            <SidebarTrigger
              onClick={() => setOpen(!open)}
              className="cursor-pointer"
            />
          </div>
        </SidebarHeader>
        <SidebarGroup>
          <SidebarGroupContent>
            <Separator />
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link to={item.url}>
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
