import { SidebarTrigger } from "@/shadcn/ui/sidebar";
import { ModeToggle } from "../theme-provider/ModeToggle";

export const MobileHeader = ({
  setOpen,
}: {
  setOpen: (open: boolean) => void;
  open: boolean;
}) => {
  return (
    <div className=" flex justify-between m-2 ">
      <SidebarTrigger
        onClick={() => setOpen(!open)}
        className="cursor-pointer"
      />
      <ModeToggle />
    </div>
  );
};
