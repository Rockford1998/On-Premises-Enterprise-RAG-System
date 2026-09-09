import { SidebarTrigger } from "@/shadcn/ui/sidebar";
import { ModeToggle } from "../theme-provider/ModeToggle";

export const MobileHeader = ({
  setOpen,
  open,
}: {
  setOpen: (open: boolean) => void;
  open: boolean;
}) => {
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <SidebarTrigger
          onClick={() => setOpen(!open)}
          className="cursor-pointer"
        />
        <span className="font-serif text-sm font-semibold tracking-tight">
          Lamma RAG
        </span>
      </div>
      <ModeToggle />
    </header>
  );
};
