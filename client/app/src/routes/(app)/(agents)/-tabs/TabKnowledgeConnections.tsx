import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { starGate } from "@/utils/starGate";
import { Button } from "@/shadcn/ui/button";
import { Badge } from "@/shadcn/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/shadcn/ui/table";
import { RefreshCw, Plug } from "lucide-react";
import { Route } from "../agent-details.$botId";
import { KnowledgeSyncLogsDialog } from "./KnowledgeSyncLogsDialog";
import { EditConnectionFoldersDialog } from "./EditConnectionFoldersDialog";
import { DeleteAlertDialogBox } from "@/routes/-components/alert-dialog-box/DeleteAlertDialogBox";

type Connection = {
  _id: string;
  provider: string;
  status: "pending" | "connected" | "error" | "disconnected";
  accountEmail?: string;
  folderIds?: string[];
  lastSyncAt?: string;
  lastSyncStatus?: "success" | "partial" | "failed" | null;
  lastSyncSummary?: {
    filesCreated: number;
    filesUpdated: number;
    filesDeleted: number;
    filesSkipped: number;
    filesFailed: number;
  };
};

type DriveFolder = {
  id: string;
  name: string;
  parentId?: string;
};

const statusVariant = (status: Connection["status"]) => {
  if (status === "connected") return "secondary";
  if (status === "error" || status === "disconnected") return "destructive";
  return "outline";
};

const POLL_INTERVAL_MS = 3000;

export const TabKnowledgeConnections = () => {
  const { botId } = Route.useParams();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [folderOptions, setFolderOptions] = useState<Record<string, DriveFolder[]>>({});
  const [foldersLoadingIds, setFoldersLoadingIds] = useState<Set<string>>(new Set());
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConnections = async () => {
    const res = await starGate.get(`/kb/connections/bot/${botId}`);
    const data: Connection[] = res.data.data ?? [];
    setConnections(data);
  };

  const loadFolders = async (connectionId: string) => {
    setFoldersLoadingIds((prev) => new Set(prev).add(connectionId));
    try {
      const res = await starGate.get(`/kb/connections/${connectionId}/folders`);
      setFolderOptions((prev) => ({ ...prev, [connectionId]: res.data.data ?? [] }));
    } catch (error: any) {
      toast(error?.response?.data?.message ?? "Failed to load Drive folders");
    } finally {
      setFoldersLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  };

  useEffect(() => {
    loadConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  // While any connection is syncing, poll its logs for completion instead of
  // requiring the user to refresh manually — mirrors the toast-on-completion
  // pattern the rest of this tab set uses for synchronous actions.
  useEffect(() => {
    if (syncingIds.size === 0) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return;

    pollRef.current = setInterval(async () => {
      for (const connectionId of Array.from(syncingIds)) {
        try {
          const res = await starGate.get(`/kb/connections/${connectionId}/logs?limit=1`);
          const latest = res.data.data?.data?.[0];
          if (latest && latest.status !== "running") {
            setSyncingIds((prev) => {
              const next = new Set(prev);
              next.delete(connectionId);
              return next;
            });
            toast(
              latest.status === "completed"
                ? `Sync finished: +${latest.summary?.filesCreated ?? 0} created, ${latest.summary?.filesUpdated ?? 0} updated, ${latest.summary?.filesDeleted ?? 0} deleted`
                : `Sync failed: ${latest.error ?? "unknown error"}`,
            );
            loadConnections();
          }
        } catch (err) {
          console.error(err);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [syncingIds]);

  const handleConnect = async () => {
    try {
      const res = await starGate.post(`/kb/connections/${botId}`);
      const authUrl = res.data.data?.authUrl;
      if (authUrl) window.location.href = authUrl;
    } catch (error: any) {
      toast(error?.response?.data?.message ?? "Failed to start connection");
    }
  };

  const handleSaveFolders = async (connectionId: string, folderIds: string[]) => {
    try {
      await starGate.put(`/kb/connections/${connectionId}/folders`, { folderIds });
      toast("Folders saved");
      loadConnections();
    } catch (error: any) {
      toast(error?.response?.data?.message ?? "Failed to save folders");
      throw error;
    }
  };

  const handleSync = async (connectionId: string) => {
    try {
      await starGate.post(`/kb/connections/${connectionId}/sync`);
      setSyncingIds((prev) => new Set(prev).add(connectionId));
      toast("Sync started");
    } catch (error: any) {
      toast(error?.response?.data?.message ?? "Failed to start sync");
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    try {
      await starGate.delete(`/kb/connections/${connectionId}`);
      toast("Connection and its synced files deleted");
      loadConnections();
    } catch (error: any) {
      toast(error?.response?.data?.message ?? "Failed to delete connection");
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button
          variant="default"
          className="h-8 cursor-pointer px-3 text-xs"
          onClick={handleConnect}
        >
          <Plug /> Connect Google Drive
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sync</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">
                No connections yet. Connect a Google Drive account to sync files into this bot's knowledge base.
              </TableCell>
            </TableRow>
          )}
          {connections.map((c) => (
            <TableRow key={c._id}>
              <TableCell>{c.accountEmail ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
              </TableCell>
              <TableCell className="text-xs">
                {c.lastSyncAt ? (
                  <div className="flex flex-col">
                    <span>{new Date(c.lastSyncAt).toLocaleString()}</span>
                    <span className="text-muted-foreground">{c.lastSyncStatus}</span>
                  </div>
                ) : (
                  "Never"
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <EditConnectionFoldersDialog
                    folders={folderOptions[c._id] ?? []}
                    foldersLoading={foldersLoadingIds.has(c._id)}
                    selectedIds={c.folderIds ?? []}
                    disabled={c.status !== "connected"}
                    onRefreshFolders={() => loadFolders(c._id)}
                    onSave={(folderIds) => handleSaveFolders(c._id, folderIds)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 cursor-pointer px-3 text-xs"
                    disabled={c.status !== "connected" || !c.folderIds?.length || syncingIds.has(c._id)}
                    onClick={() => handleSync(c._id)}
                  >
                    <RefreshCw className={syncingIds.has(c._id) ? "animate-spin" : ""} />
                    {syncingIds.has(c._id) ? "Syncing..." : "Sync"}
                  </Button>
                  <KnowledgeSyncLogsDialog connectionId={c._id} />
                  <DeleteAlertDialogBox
                    title="Delete this Google Drive connection?"
                    description="This permanently removes the connection and every knowledge base file it synced. This cannot be undone."
                    confirmLabel="Delete"
                    onConfirm={() => handleDisconnect(c._id)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
