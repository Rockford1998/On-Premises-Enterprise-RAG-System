import React, { useState, useEffect } from "react";
import { Box, Typography, LinearProgress, Alert, Paper } from "@mui/material";

interface ChatBotResponseProps {
  prompt: string;
}

export const ChatBotResponse: React.FC<ChatBotResponseProps> = ({ prompt }) => {
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!prompt) return;

    const fetchStream = async () => {
      setLoading(true);
      setError("");
      setResponse("");

      try {
        const response = await fetch("http://localhost:3000/streamChat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No reader available");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process each complete line
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              // Handle SSE format (data: {...})
              const eventData = line.startsWith("data: ")
                ? line.substring(6)
                : line;
              const parsed = JSON.parse(eventData);

              if (parsed.text) {
                setResponse((prev) => prev + parsed.text);
              }

              if (parsed.done) {
                return; // End of stream
              }

              if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (err) {
              console.error("Error parsing:", line, err);
              // Continue processing other lines even if one fails
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect");
      } finally {
        setLoading(false);
      }
    };

    fetchStream();
  }, [prompt]);

  if (error) {
    return (
      <Alert severity="error" sx={{ my: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ my: 2 }}>
      {loading && <LinearProgress />}

      {response && (
        <Paper elevation={2} sx={{ p: 2, whiteSpace: "pre-wrap" }}>
          <Typography component="div">{response}</Typography>
        </Paper>
      )}
    </Box>
  );
};
