import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/shadcn/ui/dialog";
import { Button } from "@/shadcn/ui/button";
import { Checkbox } from "@/shadcn/ui/checkbox";
import { Pen, RefreshCw } from "lucide-react";

type DriveFolder = {
  id: string;
  name: string;
  parentId?: string;
};

export const EditConnectionFoldersDialog = ({
  folders,
  foldersLoading,
  selectedIds,
  disabled,
  onRefreshFolders,
  onSave,
}: {
  folders: DriveFolder[];
  foldersLoading: boolean;
  selectedIds: string[];
  disabled?: boolean;
  onRefreshFolders: () => void;
  onSave: (folderIds: string[]) => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraftIds(new Set(selectedIds));
      if (folders.length === 0) onRefreshFolders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleFolder = (folderId: string) => {
    setDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(Array.from(draftIds));
      setOpen(false);
    } catch {
      // parent already surfaces the error via toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="cursor-pointer"
          disabled={disabled}
        >
          <Pen />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Folders to sync</DialogTitle>
          <DialogDescription>
            Choose the Drive folders this connection should sync into the
            knowledge base.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {draftIds.size} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 cursor-pointer px-2 text-xs"
            onClick={onRefreshFolders}
            disabled={foldersLoading}
          >
            <RefreshCw className={foldersLoading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-md border p-2">
          {foldersLoading && folders.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">Loading folders...</p>
          )}
          {!foldersLoading && folders.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">No folders found in this Drive account.</p>
          )}
          {folders.map((folder) => (
            <label
              key={folder.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={draftIds.has(folder.id)}
                onCheckedChange={() => toggleFolder(folder.id)}
              />
              {folder.name}
            </label>
          ))}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" className="cursor-pointer">
              Cancel
            </Button>
          </DialogClose>
          <Button
            className="cursor-pointer"
            disabled={saving || draftIds.size === 0}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
