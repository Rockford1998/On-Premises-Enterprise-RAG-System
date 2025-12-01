import { useStoreAuth } from "@/store/useStoreAuth";
import { mediator } from "@/utils/mediator";
import { useEffect, useState } from "react";
import { DataTable } from "../DataTable";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/shadcn/ui/button";
import { Pen, Trash } from "lucide-react";
import { Badge } from "@/shadcn/ui/badge";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useNavigate } from "react-router";
import { CreateBotDialog } from "../bot-hub/CreateBotDialog";
import { useRefreshData } from "@/components/hook/useRefreshData";
import { DeleteConfirmation } from "@/components/dialog-box/DeleteConfirmation";

type Bot = {
  _id: string;
  botName: string;
  botId: string;
  owner: string;
  isActive: string;
  botType: string;
};

export const AgentsOverview = () => {
  const userProfile = useStoreAuth((state) => state.userProfile);
  const navigate = useNavigate();
  const [bots, setBots] = useState<any>([]);
  const { count, refreshData } = useRefreshData();

  useEffect(() => {
    (async () => {
      const res = await mediator.get(`bots/owner/${userProfile.email}`);
      setBots(res.data.data);
    })();
  }, [count, userProfile.email]);

  const columns: ColumnDef<Bot>[] = [
    {
      accessorKey: "botName",
      header: "Name",
      size: 300,
    },
    {
      accessorKey: "owner.email",
      header: "owner",
      size: 300,
    },
    {
      accessorKey: "botType",
      header: "Type",
      size: 300,
      cell: ({ row }) => {
        const bot = row.original;
        return bot.botType === "General_Purpose" ? (
          <Badge
            variant="outline"
            className="bg-teal-600 text-white border-teal-600 dark:bg-teal-500 dark:text-white dark:border-teal-500"
          >
            General Purpose
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-amber-500 text-black border-amber-500 dark:bg-amber-400 dark:text-black dark:border-amber-400"
          >
            Knowledge
          </Badge>
        );
      },
    },
    {
      accessorKey: "isActive",
      header: "Is active",
      size: 800,
      cell: ({ row }) => {
        const bot = row.original;
        return bot.isActive ? (
          <Badge>Active</Badge>
        ) : (
          <Badge variant={"destructive"}>Inactive</Badge>
        );
      },
    },
    {
      id: "actions",
      header: "Action",
      size: 50,
      cell: ({ row }) => {
        const bot = row.original;
        return (
          <>
            <Button
              size={"icon"}
              variant={"ghost"}
              className="cursor-pointer"
              onClick={() => navigate(`/agents/detail/${bot.botId}`)}
            >
              <Pen />
            </Button>
            <DeleteConfirmation
              title="Delete Bot"
              confirmText={`${bot.botId}`}
              deleteUrl={`/bots/${bot.botId}`}
              triggerType="icon"
              triggerIcon={<Trash />}
              refreshData={refreshData}
            />
          </>
        );
      },
    },
  ];

  return (
    <PageWrapper
      title="Agents"
      actions={
        <>
          <CreateBotDialog refreshData={refreshData} />
        </>
      }
    >
      <DataTable columns={columns} data={bots} />
    </PageWrapper>
  );
};
