import { useEffect, useState } from "react";
import { starGate } from "@/utils/starGate";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DeleteAlertDialogBox } from "@/routes/-components/alert-dialog-box/DeleteAlertDialogBox";
import { useRefreshData } from "@/routes/-components/hook/useRefreshData";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/shadcn/ui/dialog";
import { Button } from "@/shadcn/ui/button";
import { Download, MessageSquareMore } from "lucide-react";
import { UploadFileDropdown } from "../-UploadFileDropdown";
import { Route } from "../agent-details.$botId";
import { DataTable } from "@/routes/-components/example-components/DataTable";
//


//
export const Tabknowledge = () => {
  const { botId } = Route.useParams();
  const [knowledge, Setknowledge] = useState<any>([]);
  const { count, refreshData } = useRefreshData();
  //
  useEffect(() => {
    (async () => {
      const res = await starGate.get(`/kb/bot-id/${botId}`);
      Setknowledge(res.data.data);

      toast(res.data.message);
    })();
  }, [botId, count]);

  const onDeletConfirm = async ({ fileName }: { fileName: string }) => {
    try {
      const res = await starGate.post("/kb/delete", {
        fileName,
        botId,
      });
      refreshData();
      toast(res.data.message);
    } catch (error: any) {
      console.log(error);
    }
  };

  const handleDownload = async ({
    fileId,
    fileName,
  }: {
    fileId: string;
    fileName: string;
  }) => {
    try {
      const res = await fetch(`/kb/download/${fileId}`, {
        method: "GET",
        headers: {
          // Add auth headers if needed
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      // Create a temporary <a> to trigger download
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName; // custom filename
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Cleanup
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Download failed");
    }
  };

  const columns: ColumnDef<Bot>[] = [
    {
      accessorKey: "fileName",
      header: "File name",
      size: 300,
    },
    {
      accessorKey: "fileSize",
      header: "Size",
      size: 300,
    },
    {
      accessorKey: "type",
      header: "Type",
    },
    {
      header: "Content",
      cell: ({ row }) => {
        const kb = row.original;
        return (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer h-8 px-3 text-xs "
              >
                <MessageSquareMore /> Knowledge
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[28rem] max-h-[32rem] flex flex-col text-xs">
              <DialogHeader className="text-xs">
                <h4>{kb.fileName} - Content</h4>
              </DialogHeader>
              <div className="flex-1 overflow-auto whitespace-pre-wrap text-xs p-2 border-l ">
                {kb.content}
              </div>
              {/* Fixed Footer */}
            </DialogContent>
          </Dialog>
        );
      },
    },
    {
      id: "actions",
      header: "Action",
      size: 50,
      cell: ({ row }) => {
        const kb = row.original;
        return (
          <>
            <DeleteAlertDialogBox
              title="Are you sure you want to delete this file?"
              onConfirm={() => onDeletConfirm({ fileName: kb.fileName })}
            />
            <Button
              size={"icon"}
              variant={"ghost"}
              className="cursor-pointer h-8 px-3 text-xs"
              onClick={() =>
                handleDownload({ fileId: kb._id, fileName: kb.fileName })
              }
            >
              <Download />
            </Button>
          </>
        );
      },
    },
  ]; 

  return (
    <div>
      <div className="flex justify-end mb-3 ">
        <UploadFileDropdown refreshData={refreshData} />
      </div>
      <DataTable columns={columns} data={knowledge} />
    </div>
  );
};
