import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/shadcn/ui/dialog";
import { Button } from "@/shadcn/ui/button";

type DialogMaxWidth =
  | "sm:max-w-sm"
  | "sm:max-w-md"
  | "sm:max-w-lg"
  | "sm:max-w-xl"
  | "sm:max-w-2xl"
  | "sm:max-w-md"
  | string; // fallback if needed
interface FormDialogBoxProps {
  title: string;
  triggerLabel: string;
  children: React.ReactNode;
  onSubmit?: () => void;
  submitLabel?: string;
  closeLabel?: string;
  maxWidth?: DialogMaxWidth;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showFooter?: boolean;
}

export const FormDialogBox: React.FC<FormDialogBoxProps> = ({
  title,
  triggerLabel,
  children,
  onSubmit,
  submitLabel = "Submit",
  closeLabel = "Close",
  maxWidth = "max-w-2xl",
  open: controlledOpen,
  onOpenChange,
  showFooter = true,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const handleOpenChange = (state: boolean) => {
    if (!isControlled) setInternalOpen(state);
    onOpenChange?.(state);
  };

  return (
    <Dialog
      open={isControlled ? controlledOpen : internalOpen}
      onOpenChange={handleOpenChange}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="cursor-pointer">
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className={maxWidth}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">{children}</div>

        {showFooter && (
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                className="cursor-pointer"
              >
                {closeLabel}
              </Button>
            </DialogClose>
            {onSubmit && (
              <Button
                type="submit"
                form="dialog-form"
                onClick={onSubmit}
                className="cursor-pointer"
              >
                {submitLabel}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
