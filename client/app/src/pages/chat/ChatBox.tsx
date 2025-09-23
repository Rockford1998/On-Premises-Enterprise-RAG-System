import { PageWrapper } from "@/components/layout/PageWrapper";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/shadcn-io/ai/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ui/shadcn-io/ai/prompt-input";
import { mediator } from "@/utils/mediator";
import { MicIcon, PaperclipIcon } from "lucide-react";
import { useState, type FormEventHandler, useEffect, useRef } from "react";
import { useParams } from "react-router";

const models = [
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
];

type ChatMessage = {
  from: "user" | "assistant";
  text: string;
};

export const ChatBox = () => {
  const [text, setText] = useState<string>("");
  const [model, setModel] = useState<string>(models[0].id);
  const [status, setStatus] = useState<
    "submitted" | "streaming" | "ready" | "error"
  >("ready");

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
    setStatus("submitted");

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
      setStatus("ready");
      setText("");
    } catch (err) {
      console.error("Chat API Error:", err);
      setMessages((prev) => [
        ...prev,
        { from: "assistant", text: "⚠️ Failed to get a response." },
      ]);
      setStatus("error");
    }
  };

  return (
    <div className="flex flex-col items-center h-screen">
      {/* Chat Messages */}
      <div className="flex-1 w-full max-w-2xl overflow-y-auto bg-gray-50">
        {messages.map((msg, idx) => (
          <Message key={idx} from={msg.from}>
            <MessageAvatar
              src={
                msg.from === "user"
                  ? "https://github.com/dovazencot.png"
                  : "https://github.com/openai.png"
              }
              name={msg.from === "user" ? "You" : "AI"}
            />
            <MessageContent>{msg.text}</MessageContent>
          </Message>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Field (Sticky Bottom) */}
      <div className="w-full max-w-2xl px-6 ">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            onChange={(e: any) => setText(e.target.value)}
            value={text}
            placeholder="Type your message..."
          />
          <PromptInputToolbar>
            <PromptInputTools>
              <PromptInputButton type="button">
                <PaperclipIcon size={16} />
              </PromptInputButton>
              <PromptInputButton type="button">
                <MicIcon size={16} />
                <span>Voice</span>
              </PromptInputButton>
              <PromptInputModelSelect onValueChange={setModel} value={model}>
                <PromptInputModelSelectTrigger>
                  <PromptInputModelSelectValue />
                </PromptInputModelSelectTrigger>
                <PromptInputModelSelectContent>
                  {models.map((model) => (
                    <PromptInputModelSelectItem key={model.id} value={model.id}>
                      {model.name}
                    </PromptInputModelSelectItem>
                  ))}
                </PromptInputModelSelectContent>
              </PromptInputModelSelect>
            </PromptInputTools>
            <PromptInputSubmit disabled={!text} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
};
