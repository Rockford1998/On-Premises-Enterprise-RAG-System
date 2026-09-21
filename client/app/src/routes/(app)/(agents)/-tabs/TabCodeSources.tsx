import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { starGate } from "@/utils/starGate";
import { Button } from "@/shadcn/ui/button";
import { Badge } from "@/shadcn/ui/badge";
import { Input } from "@/shadcn/ui/input";
import { Label } from "@/shadcn/ui/label";
import { Switch } from "@/shadcn/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shadcn/ui/table";
import { DeleteAlertDialogBox } from "@/routes/-components/alert-dialog-box/DeleteAlertDialogBox";
import { Route } from "../agent-details.$botId";

type Repo = {
  id: number;
  name: string;
  sourceType: string;
  files: number;
  units: number;
  edges: number;
  updatedAt: string;
};

type RunStatus = "running" | "completed" | "partial" | "failed";

type Run = {
  _id: string;
  repoName?: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  fileErrors?: { path: string; reason: string }[];
  stats?: {
    phase?: string;
    done?: number;
    total?: number;
    files?: number;
    skipped?: number;
    units?: number;
    edges?: number;
    embedded?: number;
    summarized?: number;
    filesChanged?: number;
    filesUnchanged?: number;
    filesRemoved?: number;
  };
};

const POLL_INTERVAL_MS = 2000;

const messageOf = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

const statusVariant = (status: RunStatus) =>
  status === "completed" ? "secondary" : status === "failed" ? "destructive" : status === "partial" ? "outline" : "default";

const PHASE_LABEL: Record<string, string> = {
  extract: "Reading files",
  parse: "Parsing",
  link: "Linking",
  load: "Embedding and saving",
  edges: "Saving relationships",
  summaries: "Summarising",
  "api-links": "Linking frontend to backend",
  done: "Done",
};

export const TabCodeSources = () => {
  const { botId } = Route.useParams();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [summarize, setSummarize] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastStatus = useRef<RunStatus | null>(null);

  const loadRepos = useCallback(async () => {
    try {
      const res = await starGate.get(`/code/${botId}/repos`);
      setRepos(res.data.data ?? []);
    } catch (error) {
      toast(messageOf(error, "Failed to load repositories"));
    }
  }, [botId]);

  const loadLatestRun = useCallback(async () => {
    try {
      const res = await starGate.get(`/code/${botId}/runs?limit=1`);
      const latest: Run | undefined = res.data.data?.[0];
      setRun(latest ?? null);
      return latest ?? null;
    } catch (error) {
      console.error(error);
      return null;
    }
  }, [botId]);

  useEffect(() => {
    loadRepos();
    loadLatestRun();
  }, [loadRepos, loadLatestRun]);

  // While a run is going, poll it; when it ends, say how it went and refresh the repository list.
  useEffect(() => {
    if (run?.status !== "running") {
      if (lastStatus.current === "running" && run) {
        toast(
          run.status === "failed"
            ? `Indexing failed: ${run.error ?? "unknown error"}`
            : run.status === "partial"
              ? `Indexed with ${run.fileErrors?.length ?? 0} file error(s)`
              : `Indexed ${run.stats?.files ?? 0} files`,
        );
        loadRepos();
      }
      lastStatus.current = run?.status ?? null;
      return;
    }
    lastStatus.current = "running";
    const timer = setInterval(loadLatestRun, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [run, loadLatestRun, loadRepos]);

  const handleUpload = async () => {
    if (!file) {
      toast("Choose a .zip file first");
      return;
    }
    const form = new FormData();
    if (name.trim()) form.append("name", name.trim());
    form.append("summarize", String(summarize));
    form.append("file", file);
    setUploading(true);
    try {
      await starGate.post(`/code/${botId}/repos`, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast("Indexing started");
      setFile(null);
      setName("");
      if (fileInput.current) fileInput.current.value = "";
      await loadLatestRun();
    } catch (error) {
      toast(messageOf(error, "Failed to upload"));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (repoId: number) => {
    try {
      await starGate.delete(`/code/${botId}/repos/${repoId}`);
      toast("Repository deleted");
      loadRepos();
    } catch (error) {
      toast(messageOf(error, "Failed to delete repository"));
    }
  };

  const running = run?.status === "running";
  const stats = run?.stats;

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4 space-y-3">
        <div className="text-sm font-medium">Add a repository</div>
        <p className="text-xs text-muted-foreground">
          Upload a .zip of the source. Dependencies (node_modules), build output and secret files such as .env are
          skipped automatically. Uploading a zip with the same repository name re-indexes it and only re-embeds what
          changed.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="code-zip" className="text-xs">Zip file</Label>
            <Input
              id="code-zip"
              ref={fileInput}
              type="file"
              accept=".zip"
              className="h-8 text-xs"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="code-name" className="text-xs">Repository name (optional)</Label>
            <Input
              id="code-name"
              value={name}
              placeholder="taken from the file name"
              className="h-8 text-xs w-56"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Switch id="code-summarize" checked={summarize} onCheckedChange={setSummarize} />
            <Label htmlFor="code-summarize" className="text-xs">Generate summaries (slow)</Label>
          </div>
          <Button className="h-8 px-3 text-xs cursor-pointer" disabled={!file || uploading || running} onClick={handleUpload}>
            <Upload /> {uploading ? "Uploading..." : "Upload & index"}
          </Button>
        </div>
        {running && <p className="text-xs text-muted-foreground">An indexing run is in progress. You can add another repository when it finishes.</p>}
      </div>

      {run && (
        <div className="rounded-md border p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Latest run</span>
            <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
            {run.repoName && <span className="text-xs text-muted-foreground">{run.repoName}</span>}
            <span className="text-xs text-muted-foreground ml-auto">{new Date(run.startedAt).toLocaleString()}</span>
          </div>
          {running && (
            <div className="text-xs">
              {PHASE_LABEL[stats?.phase ?? ""] ?? "Starting"}
              {stats?.total ? ` — ${stats.done ?? 0} of ${stats.total} files` : ""}
            </div>
          )}
          {stats?.files !== undefined && (
            <div className="text-xs text-muted-foreground">
              {stats.files} files · {stats.units ?? 0} code units · {stats.edges ?? 0} relationships ·{" "}
              {stats.embedded ?? 0} embedded
              {stats.filesUnchanged ? ` · ${stats.filesUnchanged} unchanged` : ""}
              {stats.filesRemoved ? ` · ${stats.filesRemoved} removed` : ""}
              {stats.skipped ? ` · ${stats.skipped} skipped` : ""}
              {stats.summarized ? ` · ${stats.summarized} summaries` : ""}
            </div>
          )}
          {run.error && <div className="text-xs text-destructive">{run.error}</div>}
          {run.fileErrors && run.fileErrors.length > 0 && (
            <div className="text-xs space-y-1">
              <div className="text-destructive">{run.fileErrors.length} file(s) could not be indexed:</div>
              <ul className="list-disc pl-5 text-muted-foreground">
                {run.fileErrors.slice(0, 10).map((e) => (
                  <li key={e.path}>
                    <span className="font-mono">{e.path}</span> — {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Repository</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Files</TableHead>
            <TableHead>Code units</TableHead>
            <TableHead>Relationships</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {repos.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">
                No repositories yet. Upload a zip to index your code.
              </TableCell>
            </TableRow>
          )}
          {repos.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-xs">{r.sourceType}</TableCell>
              <TableCell>{r.files}</TableCell>
              <TableCell>{r.units}</TableCell>
              <TableCell>{r.edges}</TableCell>
              <TableCell className="text-xs">{new Date(r.updatedAt).toLocaleString()}</TableCell>
              <TableCell>
                <DeleteAlertDialogBox
                  title={`Delete "${r.name}"?`}
                  description="This removes the repository's indexed code, relationships and embeddings from this bot. It cannot be undone."
                  confirmLabel="Delete"
                  onConfirm={() => handleDelete(r.id)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
