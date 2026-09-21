import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Bot, Loader2, User, Wrench } from "lucide-react";
import { PageWrapper } from "@/routes/-components/layout/PageWrapper";
import { Badge } from "@/shadcn/ui/badge";
import { Button } from "@/shadcn/ui/button";
import { Label } from "@/shadcn/ui/label";
import { Switch } from "@/shadcn/ui/switch";
import { Textarea } from "@/shadcn/ui/textarea";
import { starGate } from "@/utils/starGate";
import { cn } from "@/shadcn/utils";
import "highlight.js/styles/github-dark.css";

export const Route = createFileRoute("/(app)/(code)/code-chat/$botId")({
  component: CodeChat,
});

type Citation = { uid: string; repo: string; path: string; startLine: number; endLine: number; name: string; kind: string };

type Message = {
  id: string;
  from: "user" | "assistant";
  text: string;
  citations?: Citation[];
  queryType?: string;
  toolCalls?: { tool: string }[];
};

const messageOf = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/** A citation the user can read at a glance: path:start-end. */
const CitationList = ({ citations }: { citations: Citation[] }) => (
  <div className="mt-2 flex flex-wrap gap-1.5">
    {citations.map((c) => (
      <Badge key={c.uid} variant="outline" className="font-mono text-[10px] font-normal" title={`${c.kind} ${c.name} in ${c.repo}`}>
        {c.path}:{c.startLine}-{c.endLine}
      </Badge>
    ))}
  </div>
);

function CodeChat() {
  const { botId } = Route.useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [agentMode, setAgentMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, from: "user", text: question }]);
    setText("");
    setLoading(true);
    try {
      const res = await starGate.post(`/code/${botId}/chat`, { question, mode: agentMode ? "agent" : "answer" });
      const data = res.data.data;
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        from: "assistant",
        text: data.answer,
        citations: data.citations,
        queryType: data.queryType,
        toolCalls: data.toolCalls,
      }]);
    } catch (error) {
      setMessages((prev) => [...prev, {
        id: `e-${Date.now()}`,
        from: "assistant",
        text: messageOf(error, "Something went wrong answering that question."),
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageWrapper title="Code chat">
      <div className="flex h-full flex-col gap-3">
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              Ask about the indexed code — for example “what happens when the users page loads?”, “where is a new user
              saved?”, or a symbol name. Every answer cites the file and lines it came from.
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className="flex gap-2">
              <div className={cn("mt-1 h-6 w-6 shrink-0 rounded-full p-1", message.from === "user" ? "bg-muted" : "bg-primary/10")}>
                {message.from === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                {message.from === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                      {message.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                )}

                {message.citations && message.citations.length > 0 && <CitationList citations={message.citations} />}

                {(message.queryType || message.toolCalls?.length) && (
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {message.queryType && <span>interpreted as: {message.queryType}</span>}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Wrench className="h-3 w-3" />
                        {message.toolCalls.map((c) => c.tool).join(" → ")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {agentMode ? "Looking through the code…" : "Searching the code…"}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="space-y-2 border-t pt-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask about this codebase…"
            className="min-h-[72px] text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(e);
              }
            }}
          />
          <div className="flex items-center gap-3">
            <Switch id="agent-mode" checked={agentMode} onCheckedChange={setAgentMode} />
            <Label htmlFor="agent-mode" className="text-xs text-muted-foreground">
              Agent mode — the model looks things up itself; slower, better for multi-step questions
            </Label>
            <Button type="submit" size="sm" className="ml-auto h-8 cursor-pointer px-4 text-xs" disabled={loading || !text.trim()}>
              Ask
            </Button>
          </div>
        </form>
      </div>
    </PageWrapper>
  );
}
