// src/App.tsx
import React, { useState, useRef, useEffect } from "react";
import "./App.css";
import { Box, Typography } from "@mui/material";

type Message = {
  text: string;
  sender: "user" | "ai" | "error";
  id?: number;
};

function App() {
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { text: input, sender: "user" };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const aiMessage: Message = { text: "", sender: "ai", id: Date.now() };
      setMessages((prev) => [...prev, aiMessage]);

      const response = await fetch("http://localhost:3000/streamChat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: input }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let aiText = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        const chunk = decoder.decode(value, { stream: true });
        aiText += chunk;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMessage.id ? { ...msg, text: aiText } : msg,
          ),
        );
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          text: `Error: ${error.message}`,
          sender: "error",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box>
      <Typography> Test </Typography>
    </Box>
  );
}

export default App;
