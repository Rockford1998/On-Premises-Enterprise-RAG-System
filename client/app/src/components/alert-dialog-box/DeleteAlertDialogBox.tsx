import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shadcn/ui/alert-dialog";
import { Button } from "@/shadcn/ui/button";
import { Trash2 } from "lucide-react";

type DeleteAlertDialogBoxProps = {
  triggerLabel?: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  buttonType?: "icon" | "button";
  onConfirm?: () => void;
};

export function DeleteAlertDialogBox({
  triggerLabel = "Delete",
  title = "Are you absolutely sure?",
  description,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  onConfirm,
  buttonType = "icon",
}: DeleteAlertDialogBoxProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {buttonType === "button" ? (
          <Button variant="destructive">{triggerLabel}</Button>
        ) : (
          <Button size={"icon"} variant={"ghost"} className="cursor-pointer">
            <Trash2 color="red" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
