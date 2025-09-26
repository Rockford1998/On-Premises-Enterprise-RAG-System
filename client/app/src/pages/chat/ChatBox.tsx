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
import { useState, type FormEventHandler, useEffect, useRef } from "react";
import { useParams } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css"; // Dark theme
import "highlight.js/styles/github.css"; // Light theme

type ChatMessage = {
  from: "user" | "assistant";
  text: string;
};

export const ChatBox = () => {
  const [text, setText] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const param = useParams();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to bottom when new message arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;

    const userMessage: ChatMessage = { from: "user", text };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const res = await mediator.post("http://localhost:3000/chat", {
        botId: param.botId,
        question: text,
      });

      const data = res.data;
      const botMessage: ChatMessage = {
        from: "assistant",
        text: data.answer || "No response received.",
      };

      setMessages((prev) => [...prev, botMessage]);
      setText("");
    } catch (err) {
      console.error("Chat API Error:", err);
      setMessages((prev) => [
        ...prev,
        { from: "assistant", text: "⚠️ Failed to get a response." },
      ]);
    }
  };

  // Custom components for better code rendering
  const MarkdownComponents = {
    h1: ({ children }: any) => (
      <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-base font-semibold mb-2 mt-3">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-sm font-semibold mb-2 mt-3">{children}</h3>
    ),
    p: ({ children }: any) => (
      <p className="my-2 text-sm leading-relaxed">{children}</p>
    ),
    ul: ({ children }: any) => (
      <ul className="list-disc ml-6 my-2 text-sm space-y-1">{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal ml-6 my-2 text-sm space-y-1">{children}</ol>
    ),
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-3">
        <table className="border-collapse border border-gray-300 dark:border-gray-600 w-full text-left text-xs">
          {children}
        </table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 bg-gray-100 dark:bg-gray-800 font-semibold text-xs">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs">
        {children}
      </td>
    ),
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || "");

      if (!inline && match) {
        return (
          <div className="relative my-4 rounded-lg overflow-hidden">
            <div className="flex justify-between items-center px-4 py-2 bg-gray-200 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
              <span className="font-medium">{match[1]}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    String(children).replace(/\n$/, ""),
                  );
                }}
                className="hover:bg-gray-300 dark:hover:bg-gray-600 px-2 py-1 rounded text-xs"
              >
                Copy
              </button>
            </div>
            <pre className="hljs bg-gray-900 p-4 overflow-x-auto text-sm">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          </div>
        );
      } else {
        return (
          <code className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono">
            {children}
          </code>
        );
      }
    },
    pre: ({ children }: any) => <>{children}</>,
  };

  return (
    <div className="flex flex-col items-center h-[90vh] w-full max-w-3xl mx-auto">
      {/* Chat Messages */}
      <div className="flex-1 w-full overflow-y-auto">
        <div className="relative w-full h-full">
          <Conversation>
            <ConversationContent>
              {messages.map((msg, idx) => (
                <Message
                  key={idx}
                  from={msg.from}
                  className={`${
                    msg.from === "user"
                      ? "justify-end w-full max-w-[80%] ml-auto"
                      : "w-full max-w-full"
                  }`}
                >
                  <MessageContent
                    className={`${
                      msg.from === "user"
                        ? "bg-blue-600 text-white rounded-2xl shadow-md"
                        : "bg-transparent text-black dark:text-white"
                    } rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700`}
                  >
                    <div className="break-words">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={MarkdownComponents}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  </MessageContent>
                </Message>
              ))}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Field (Sticky Bottom) */}
      <div className="w-full mt-4">
        <PromptInput onSubmit={handleSubmit} className="h-12">
          <PromptInputTextarea
            onChange={(e: any) => setText(e.target.value)}
            value={text}
            placeholder="Ask anything"
            className="text-black dark:text-white bg-transparent"
            minHeight={12}
            maxHeight={12}
          />
        </PromptInput>
      </div>
    </div>
  );
};
