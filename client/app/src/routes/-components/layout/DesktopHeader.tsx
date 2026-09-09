import { SidebarTrigger } from "@/shadcn/ui/sidebar";
import { Separator } from "@/shadcn/ui/separator";
import { ModeToggle } from "../theme-provider/ModeToggle";

export const DesktopHeader = () => {
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/60 md:px-6 lg:px-8">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="cursor-pointer" />
        <Separator orientation="vertical" className="h-4" />
      </div>
      <ModeToggle />
    </header>
  );
};
