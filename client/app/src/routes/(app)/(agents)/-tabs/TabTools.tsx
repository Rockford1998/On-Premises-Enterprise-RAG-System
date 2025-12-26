import { DeleteAlertDialogBox } from "@/routes/-components/alert-dialog-box/DeleteAlertDialogBox";
import { DataTable } from "@/routes/-components/example-components/DataTable";
import { starGate } from "@/utils/starGate";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Route } from "../agent-details.$botId";
import { Pen } from "lucide-react";
import { Button } from "@/shadcn/ui/button";
import { useRefreshData } from "@/routes/-components/hook/useRefreshData";
import { useNavigate } from "@tanstack/react-router";

export const TabTools = () => {
  const { tools, columns } = useTabTools();
  return (
    <div>
      <DataTable columns={columns} data={tools} />
    </div>
  );
};

type Bot = {
  _id: string;
  name: string;
  type: string;
  description: string;
};

const useTabTools = () => {
  const { botId } = Route.useParams();
  const [tools, setTools] = useState<any>([]);
  const { count, refreshData } = useRefreshData();

  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const res = await starGate.get(`/tools/bot/${botId}`);
      setTools(res.data.data);
      toast(res.data.message);
    })();
  }, [count, botId]);

  const onDeletConfirm = async ({ id }: { id: string }) => {
    try {
      const res = await starGate.delete(`/tools/${id}`);
      refreshData();
      toast(res.data.message);
    } catch (error: any) {
      console.log(error);
    }
  };

  //
  const columns: ColumnDef<Bot>[] = [
    {
      accessorKey: "name",
      header: "Tool name",
      size: 300,
    },
    {
      accessorKey: "type",
      header: "Type",
      size: 300,
    },
    {
      accessorKey: "description",
      header: "Description",
    },
    {
      id: "actions",
      header: "Action",
      size: 50,
      cell: ({ row }) => {
        const tool = row.original;
        return (
          <>
            <Button
              size={"icon"}
              variant={"ghost"}
              className="cursor-pointer"
              onClick={() => navigate({ to: `/agent/tools/${tool._id}` })}
            >
              <Pen />
            </Button>
            <DeleteAlertDialogBox
              title="Are you sure you want to delete this tool?"
              onConfirm={() => onDeletConfirm({ id: tool._id })}
            />
          </>
        );
      },
    },
  ];

  return {
    tools,
    columns,
  };
};
