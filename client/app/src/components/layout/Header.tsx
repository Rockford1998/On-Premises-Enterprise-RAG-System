import { useIsMobile } from "@/shadcn/hooks/use-mobile";
import { SidebarTrigger } from "@/shadcn/ui/sidebar";

export const Header = ({
  setOpen,
}: {
  setOpen: (open: boolean) => void;
  open: boolean;
}) => {
  const isMobile = useIsMobile();

  return (
    <>
      {isMobile && (
        <SidebarTrigger
          onClick={() => setOpen(!open)}
          className="cursor-pointer"
        />
      )}
    </>
  );
};
