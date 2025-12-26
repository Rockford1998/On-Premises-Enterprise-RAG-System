import { useStoreAuth } from "@/store/useStoreAuth";
import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/shadcn/ui/button";
import { Pen, Trash } from "lucide-react";
import { Badge } from "@/shadcn/ui/badge";
import { PageWrapper } from "@/routes/-components/layout/PageWrapper";
import { useRefreshData } from "@/routes/-components/hook/useRefreshData";
import { DeleteConfirmation } from "@/routes/-components/dialog-box/DeleteConfirmation";
import { starGate } from "@/utils/starGate";
import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { CreateBotDialog } from "../(hub)/-CreateBotDialog";
import { DataTable } from "@/routes/-components/example-components/DataTable";

type Bot = {
  _id: string;
  botName: string;
  botId: string;
  owner: string;
  isActive: string;
  botType: string;
};

export const Route = createFileRoute("/(app)/(agents)/agent-overview")({
  component: AgentsOverview,
});

function AgentsOverview() {
  const userProfile = useStoreAuth((state) => state.userProfile) || null;
  const navigate = useNavigate();
  const [bots, setBots] = useState<any>([]);
  const { count, refreshData } = useRefreshData();

  useEffect(() => {
    const fetchBots = async () => {
      // Only fetch if userProfile exists
      if (!userProfile) return;
      try {
        const res = await starGate.get(`bots/owner/${userProfile.email}`);
        setBots(res.data.data || []);
      } catch (error) {
        console.error("Error fetching bots:", error);
        setBots([]);
      }
    };

    fetchBots();
  }, [count, userProfile]);

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
              onClick={() => navigate({ to: `/agent-details/${bot.botId}` })}
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
}
