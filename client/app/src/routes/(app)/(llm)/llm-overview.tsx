import { createFileRoute } from "@tanstack/react-router";
import { PageWrapper } from "@/routes/-components/layout/PageWrapper";
import { DataTable } from "@/routes/-components/example-components/DataTable";
import { DeleteAlertDialogBox } from "@/routes/-components/alert-dialog-box/DeleteAlertDialogBox";
import { useRefreshData } from "@/routes/-components/hook/useRefreshData";
import { Badge } from "@/shadcn/ui/badge";
import { Switch } from "@/shadcn/ui/switch";
import { starGate } from "@/utils/starGate";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LlmModelFormDialog, type LlmModelRecord } from "./-LlmModelFormDialog";

export const Route = createFileRoute("/(app)/(llm)/llm-overview")({
  component: RouteComponent,
});

function RouteComponent() {
  const { models, columns, refreshData } = useLlmModels();

  return (
    <PageWrapper
      title="LLM Models"
      actions={<LlmModelFormDialog mode="create" refreshData={refreshData} />}
    >
      <DataTable columns={columns} data={models} />
    </PageWrapper>
  );
}

const useLlmModels = () => {
  const [models, setModels] = useState<LlmModelRecord[]>([]);
  const { count, refreshData } = useRefreshData();

  useEffect(() => {
    (async () => {
      try {
        // Registry is small and admin-facing — one generous page rather than
        // building out paginated list UI for it.
        const res = await starGate.get("/llm", { params: { size: 100 } });
        setModels(res.data.data.data ?? []);
      } catch (error) {
        console.error(error);
        toast.error("Failed to load LLM models.");
      }
    })();
  }, [count]);

  const toggleActive = async (model: LlmModelRecord) => {
    try {
      await starGate.put(`/llm/${model._id}`, { isActive: !model.isActive });
      refreshData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to update model status.");
    }
  };

  const onDeleteConfirm = async (model: LlmModelRecord) => {
    try {
      await starGate.delete(`/llm/${model._id}`);
      toast(`"${model.name}" deleted.`);
      refreshData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete model.");
    }
  };

  const columns: ColumnDef<LlmModelRecord>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">
              {row.original.description}
            </div>
          )}
        </div>
      ),
    },
    { accessorKey: "provider", header: "Provider" },
    {
      id: "modelType",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="secondary">{row.original.meta?.modelType}</Badge>
      ),
    },
    {
      id: "contextWindow",
      header: "Context",
      cell: ({ row }) => row.original.meta?.contextWindow ?? "-",
    },
    {
      id: "capabilities",
      header: "Capabilities",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.meta?.supportsTools && (
            <Badge variant="outline" className="text-[10px]">
              tools
            </Badge>
          )}
          {row.original.meta?.supportsStreaming && (
            <Badge variant="outline" className="text-[10px]">
              streaming
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "tags",
      header: "Tags",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {(row.original.tags ?? []).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "isActive",
      header: "Active",
      cell: ({ row }) => (
        <Switch
          className="cursor-pointer"
          checked={row.original.isActive}
          onCheckedChange={() => toggleActive(row.original)}
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      size: 90,
      cell: ({ row }) => (
        <div className="flex items-center">
          <LlmModelFormDialog mode="edit" model={row.original} refreshData={refreshData} />
          <DeleteAlertDialogBox
            title="Delete this LLM model?"
            description={`This removes "${row.original.name}" from the registry. Bots already configured with it keep their existing snapshot.`}
            onConfirm={() => onDeleteConfirm(row.original)}
          />
        </div>
      ),
    },
  ];

  return { models, columns, refreshData };
};
