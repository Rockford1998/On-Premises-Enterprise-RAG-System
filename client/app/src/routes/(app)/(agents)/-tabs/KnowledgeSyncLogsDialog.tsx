import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shadcn/ui/dialog";
import { Button } from "@/shadcn/ui/button";
import { Badge } from "@/shadcn/ui/badge";
import { ScrollText, ChevronDown, ChevronRight } from "lucide-react";
import { starGate } from "@/utils/starGate";

type FileResult = {
  externalId: string;
  fileName: string;
  action: "created" | "updated" | "deleted" | "skipped" | "failed";
  reason?: string;
};

type SyncLog = {
  _id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  triggeredBy?: string;
  error?: string;
  summary?: {
    filesTotal: number;
    filesCreated: number;
    filesUpdated: number;
    filesDeleted: number;
    filesSkipped: number;
    filesFailed: number;
  };
  fileResults?: FileResult[];
};

const statusVariant = (status: SyncLog["status"]) =>
  status === "completed" ? "secondary" : status === "failed" ? "destructive" : "outline";

const LogRow = ({ log }: { log: SyncLog }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="font-medium">{new Date(log.startedAt).toLocaleString()}</span>
          <Badge variant={statusVariant(log.status)}>{log.status}</Badge>
        </div>
        {log.summary && (
          <span className="text-muted-foreground">
            +{log.summary.filesCreated} created, {log.summary.filesUpdated} updated,{" "}
            {log.summary.filesDeleted} deleted, {log.summary.filesSkipped} skipped
            {log.summary.filesFailed ? `, ${log.summary.filesFailed} failed` : ""}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t px-3 py-2 text-xs">
          {log.error && <p className="mb-2 text-destructive">{log.error}</p>}
          {log.fileResults && log.fileResults.length > 0 ? (
            <ul className="space-y-1">
              {log.fileResults.map((f) => (
                <li key={f.externalId + f.action} className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.fileName}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {f.reason && <span className="text-muted-foreground">{f.reason}</span>}
                    <Badge variant={f.action === "failed" ? "destructive" : "secondary"}>{f.action}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No file-level detail for this run.</p>
          )}
        </div>
      )}
    </div>
  );
};

export const KnowledgeSyncLogsDialog = ({ connectionId }: { connectionId: string }) => {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await starGate.get(`/kb/connections/${connectionId}/logs`);
      setLogs(res.data.data?.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => open && loadLogs()}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 cursor-pointer px-3 text-xs">
          <ScrollText /> Agent Logs
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Sync history</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
          {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
          {!loading && logs.length === 0 && (
            <p className="text-xs text-muted-foreground">No sync runs yet.</p>
          )}
          {logs.map((log) => (
            <LogRow key={log._id} log={log} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
