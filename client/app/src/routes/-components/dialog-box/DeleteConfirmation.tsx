import { Button } from "@/shadcn/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shadcn/ui/dialog";
import { Input } from "@/shadcn/ui/input";
import { Label } from "@/shadcn/ui/label";
import { starGate } from "@/utils/starGate";
import React, { useState } from "react";

interface DeleteConfirmationProps {
  title: string;
  confirmText: string;
  deleteUrl: string;

  // trigger behavior
  triggerType?: "button" | "icon" | "custom";
  triggerLabel?: string; // label for button
  triggerVariant?:
    | "default"
    | "secondary"
    | "outline"
    | "ghost"
    | "destructive";
  triggerIcon?: React.ReactNode; // ex: <Trash />
  // custom trigger override
  customTrigger?: React.ReactNode;
  refreshData: () => void;
}

export const DeleteConfirmation = ({
  title,
  confirmText,
  deleteUrl,
  triggerType = "button",
  triggerLabel = "Delete",
  triggerVariant = "destructive",
  triggerIcon,
  customTrigger,
  refreshData,
}: DeleteConfirmationProps) => {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);

    try {
      await starGate.delete(deleteUrl);
      refreshData();
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  const renderTrigger = () => {
    if (triggerType === "custom" && customTrigger) return customTrigger;

    if (triggerType === "icon") {
      return (
        <Button size="icon" variant={triggerVariant} className="color-red">
          {triggerIcon}
        </Button>
      );
    }

    return (
      <Button variant={triggerVariant}>
        {triggerIcon && <span className="mr-2">{triggerIcon}</span>}
        {triggerLabel}
      </Button>
    );
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{renderTrigger()}</DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Confirm to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm">
            Type <span className="font-mono font-semibold">{confirmText}</span>{" "}
            to confirm
          </Label>

          <Input
            id="confirm"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={confirmText}
          />
        </div>

        <DialogFooter>
          <DialogTrigger asChild>
            <Button variant="outline">Cancel</Button>
          </DialogTrigger>

          <Button
            onClick={handleDelete}
            variant="destructive"
            disabled={inputValue !== confirmText || loading}
          >
            {loading ? "Deleting..." : "Confirm Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
