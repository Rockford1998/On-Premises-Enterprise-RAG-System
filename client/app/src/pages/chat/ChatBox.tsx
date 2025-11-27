import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ui/shadcn-io/ai/conversation";
import { Message, MessageContent } from "@/components/ui/shadcn-io/ai/message";
import {
  PromptInput,
  PromptInputTextarea,
} from "@/components/ui/shadcn-io/ai/prompt-input";
import { mediator } from "@/utils/mediator";
import {
  useState,
  type FormEventHandler,
  useEffect,
  useRef,
  useCallback,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Loader2, Copy, CheckCheck, Bot, User } from "lucide-react";
import { cn } from "@/shadcn/utils";
import "highlight.js/styles/github-dark.css";
import "highlight.js/styles/github.css";
import { useParams } from "react-router";

type ChatMessage = {
  id: string;
  from: "user" | "assistant";
  text: string;
  timestamp: Date;
  isStreaming?: boolean;
};

export const ChatBox = () => {
  const [text, setText] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  const param = useParams<{ botId?: string }>();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* --------------------------------------------------------------
   * Auto‑scroll & focus
   * -------------------------------------------------------------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  /* --------------------------------------------------------------
   * Helper callbacks
   * -------------------------------------------------------------- */
  const handleCopyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  }, []);

  const handleCopyMessage = useCallback(
    async (msgText: string, messageId: string) => {
      try {
        await navigator.clipboard.writeText(msgText);
        setCopiedMessageId(messageId);
        setTimeout(() => setCopiedMessageId(null), 2000);
      } catch (err) {
        console.error("Failed to copy message:", err);
      }
    },
    []
  );

  /* --------------------------------------------------------------
   * Submit handler
   * -------------------------------------------------------------- */
  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      from: "user",
      text: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setText("");
    setIsLoading(true);

    try {
      const res = await mediator.post("http://localhost:3000/chat", {
        botId: param?.botId, // safe access
        question: text,
      });

      const data = res.data;
      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        from: "assistant",
        text: data.answer || "No response received.",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      console.error("Chat API Error:", err);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        from: "assistant",
        text:
          "⚠️ Sorry, I encountered an error while processing your request. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  /* --------------------------------------------------------------
   * Markdown renderers
   * -------------------------------------------------------------- */
  const MarkdownComponents = {
    h1: ({ children }: any) => (
      <h1 className="text-xl font-bold mb-3 mt-4 text-gray-900 dark:text-gray-100">
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-lg font-semibold mb-3 mt-4 text-gray-900 dark:text-gray-100">
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-base font-semibold mb-2 mt-3 text-gray-900 dark:text-gray-100">
        {children}
      </h3>
    ),
    p: ({ children }: any) => (
      <p className="my-3 text-sm leading-relaxed text-gray-800 dark:text-gray-200">
        {children}
      </p>
    ),
    ul: ({ children }: any) => (
      <ul className="list-disc ml-6 my-3 text-sm space-y-2 text-gray-800 dark:text-gray-200">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal ml-6 my-3 text-sm space-y-2 text-gray-800 dark:text-gray-200">
        {children}
      </ol>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-blue-500 pl-4 my-3 italic text-gray-600 dark:text-gray-400">
        {children}
      </blockquote>
    ),
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-4 rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="border-collapse w-full text-sm">{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className="border border-gray-200 dark:border-gray-700 px-4 py-2 bg-gray-50 dark:bg-gray-800 font-semibold text-gray-900 dark:text-gray-100 text-left">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border border-gray-200 dark:border-gray-700 px-4 py-2 text-gray-800 dark:text-gray-200">
        {children}
      </td>
    ),
    code: ({
      inline,
      className,
      children,
      ...props
    }: any) => {
      const match = /language-(\w+)/.exec(className || "");
      const codeText = String(children).replace(/\n$/, "");

      if (!inline && match) {
        return (
          <div className="relative my-4 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
                {match[1]}
              </span>
              <button
                onClick={() => handleCopyCode(codeText)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-none dark:hover:bg-gray-700 rounded transition-colors cursor-pointer"
              >
                {copiedCode ?
                  < CheckCheck size={14} />
                  : < Copy size={14} />
                }
                {copiedCode ?
                  "Copied"
                  : "Copy code"
                }

              </button>
            </div>
            <pre className="hljs bg-gray-900 p-4 overflow-x-auto text-sm">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          </div>
        );
      }
      return (
        <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
          {children}
        </code>
      );
    },
    pre: ({ children }: any) => <>{children}</>,
  };

  /* --------------------------------------------------------------
   * Render
   * -------------------------------------------------------------- */
  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto ">
      {/* -------------------------------------------------- */}
      {/* Messages Container */}
      {/* -------------------------------------------------- */}
      <div className="flex-1 overflow-hidden ">
        <Conversation className="h-full">
          <ConversationContent className="p-4 space-y-6">
            {/* Empty state */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                <Bot size={48} className="mb-4 text-gray-400" />
                <h3 className="text-lg font-semibold mb-2">
                  How can I help you today?
                </h3>
                <p className="text-sm">
                  Start a conversation by typing a message below.
                </p>
              </div>
            )}

            {/* Message list */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex w-full",
                  msg.from === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "flex gap-3 max-w-[80%]",
                    msg.from === "user" && "flex-row-reverse"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white mt-1",
                      msg.from === "user"
                        ? "bg-gradient-to-br from-gray-500 to-white-700"
                        : "bg-gradient-to-br from-gray-500 to-white-500"
                    )}
                  >
                    {msg.from === "user" ? (
                      <User size={16} />
                    ) : (
                      <Bot size={16} />
                    )}
                  </div>

                  {/* Message bubble & copy btn */}
                  <div className="relative group max-w-full">

                    {/* Rendered message content */}
                    <div className="group-hover:opacity-100">
                      <ReactMarkdown
                        key={msg.id}
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={MarkdownComponents}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>

                    {/* Copy button */}
                    {msg.from === "user" ? (
                      <button
                        onClick={() => handleCopyMessage(msg.text, msg.id)}
                        className={cn(
                          "absolute bottom--0.5 left-1 opacity-0 group-hover:opacity-100",
                          "transition-opacity p-1.5 rounded bg-white dark:bg-gray-700 shadow-sm",
                          "border border-gray-200 dark:border-gray-600 cursor-pointer"
                        )}
                      >
                        {copiedMessageId === msg.id ? <CheckCheck size={14} /> : <Copy size={14} />}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCopyMessage(msg.text, msg.id)}
                        className={cn(
                          "absolute top-1 right-1 opacity-0 group-hover:opacity-100",
                          "transition-opacity p-1.5 rounded bg-white dark:bg-gray-700 shadow-sm",
                          "border border-gray-200 dark:border-gray-600 cursor-pointer"
                        )}
                      >
                        {copiedMessageId === msg.id ? <CheckCheck size={14} /> : <Copy size={14} />}
                      </button>
                    )}
                  </div>

                </div>
              </div>
            ))}

            {/* Loading spinner */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-3 max-w-[80%]">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-gray-500 to-white-500 text-white">
                    <Bot size={16} />
                  </div>
                  <Message from="assistant">
                    <MessageContent className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    </MessageContent>
                  </Message>
                </div>
              </div>
            )}
            {/* Anchor for auto‑scroll */}
            <div ref={messagesEndRef} />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* -------------------------------------------------- */}
      {/* Input Area */}
      {/* -------------------------------------------------- */}
      <div className="border-t  p-4 sticky bottom-0" >
        <div>
          <PromptInput onSubmit={handleSubmit} className="min-h-12">
            <PromptInputTextarea
              ref={textareaRef}
              onChange={(e) => setText(e.target.value)}
              value={text}
              placeholder="Ask anything..."
              className="text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl resize-none pr-12"
              minHeight={20}
              maxHeight={50}
              disabled={isLoading}
            />
          </PromptInput>
        </div>

        {/* Helper text */}
        <div className="text-xs text-center text-gray-500 dark:text-gray-400 mt-3">
          Press Enter to send, Shift + Enter for new line
        </div>
      </div>
    </div>
  );
};