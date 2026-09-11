import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { starGate } from "@/utils/starGate";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { Badge } from "@/shadcn/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/ui/select";
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
import { DeleteAlertDialogBox } from "@/routes/-components/alert-dialog-box/DeleteAlertDialogBox";

type Connection = {
  _id: string;
  provider: string;
  status: "pending" | "connected" | "error" | "disconnected";
  accountEmail?: string;
  folderId?: string;
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
  const [folderDrafts, setFolderDrafts] = useState<Record<string, string>>({});
  const [folderOptions, setFolderOptions] = useState<Record<string, DriveFolder[]>>({});
  const [foldersLoadingIds, setFoldersLoadingIds] = useState<Set<string>>(new Set());
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConnections = async () => {
    const res = await starGate.get(`/kb/connections/bot/${botId}`);
    const data: Connection[] = res.data.data ?? [];
    setConnections(data);
    setFolderDrafts((prev) => {
      const next = { ...prev };
      for (const c of data) if (!(c._id in next)) next[c._id] = c.folderId ?? "";
      return next;
    });
    for (const c of data) {
      if (c.status === "connected" && !(c._id in folderOptions)) loadFolders(c._id);
    }
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

  const handleSaveFolder = async (connectionId: string) => {
    try {
      await starGate.put(`/kb/connections/${connectionId}/folder`, {
        folderId: folderDrafts[connectionId]?.trim(),
      });
      toast("Folder saved");
      loadConnections();
    } catch (error: any) {
      toast(error?.response?.data?.message ?? "Failed to save folder");
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
            <TableHead>Provider</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Folder ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sync</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                No connections yet. Connect a Google Drive account to sync files into this bot's knowledge base.
              </TableCell>
            </TableRow>
          )}
          {connections.map((c) => (
            <TableRow key={c._id}>
              <TableCell className="capitalize">{c.provider.replace("_", " ")}</TableCell>
              <TableCell>{c.accountEmail ?? "—"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={
                      (folderOptions[c._id] ?? []).some((f) => f.id === folderDrafts[c._id])
                        ? folderDrafts[c._id]
                        : undefined
                    }
                    onValueChange={(value) =>
                      setFolderDrafts((prev) => ({ ...prev, [c._id]: value }))
                    }
                    disabled={c.status !== "connected" || foldersLoadingIds.has(c._id)}
                  >
                    <SelectTrigger className="h-7 w-40 text-xs">
                      <SelectValue
                        placeholder={foldersLoadingIds.has(c._id) ? "Loading..." : "Pick a folder"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(folderOptions[c._id] ?? []).map((f) => (
                        <SelectItem key={f.id} value={f.id} className="text-xs">
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={folderDrafts[c._id] ?? ""}
                    onChange={(e) =>
                      setFolderDrafts((prev) => ({ ...prev, [c._id]: e.target.value }))
                    }
                    placeholder="or paste folder ID"
                    className="h-7 w-32 text-xs"
                    disabled={c.status !== "connected"}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs cursor-pointer"
                    disabled={c.status !== "connected"}
                    onClick={() => handleSaveFolder(c._id)}
                  >
                    Save
                  </Button>
                </div>
              </TableCell>
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 cursor-pointer px-3 text-xs"
                    disabled={c.status !== "connected" || !c.folderId || syncingIds.has(c._id)}
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
