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
import { Check, Copy, FileText, MessageSquareMore } from "lucide-react";

type KnowledgeEntry = {
  fileName: string;
  content: string;
  type: string;
  fileSize: number;
  chunksTotal?: number;
  source?: string;
  createdAt?: string;
};

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
};

const simplifyType = (mime: string) => {
  if (!mime) return "file";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("docx")) return "DOCX";
  if (mime.includes("presentation") || mime.includes("pptx")) return "PPTX";
  if (mime.includes("text")) return "TXT";
  return mime.split("/").pop()?.toUpperCase() ?? "FILE";
};

export const KnowledgeContentDialog = ({ kb }: { kb: KnowledgeEntry }) => {
  const [copied, setCopied] = useState(false);

  const wordCount = kb.content?.trim()
    ? kb.content.trim().split(/\s+/).length
    : 0;
  const charCount = kb.content?.length ?? 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(kb.content ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy extracted content:", err);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 cursor-pointer px-3 text-xs">
          <MessageSquareMore /> Knowledge
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="gap-3 border-b border-border px-5 pt-5 pb-4">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <FileText className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate font-serif text-base font-semibold">
                {kb.fileName}
              </DialogTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{simplifyType(kb.type)}</Badge>
                <Badge variant="secondary">{formatBytes(kb.fileSize)}</Badge>
                {typeof kb.chunksTotal === "number" && (
                  <Badge variant="secondary">
                    {kb.chunksTotal} {kb.chunksTotal === 1 ? "chunk" : "chunks"} indexed
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {kb.content ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
              {kb.content}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No extracted content is available for this file.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {wordCount.toLocaleString()} words · {charCount.toLocaleString()} characters
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 cursor-pointer px-2 text-xs"
            onClick={handleCopy}
            disabled={!kb.content}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
