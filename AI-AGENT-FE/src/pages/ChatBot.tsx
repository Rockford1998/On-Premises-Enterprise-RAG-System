import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  Box,
  TextField,
  Button,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  Typography,
  Paper,
  IconButton,
  CircularProgress,
} from "@mui/material";
import { Send, Stop, SmartToy, Person } from "@mui/icons-material";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
}

export const ChatWindow = () => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      content: input,
      role: "user",
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Add empty assistant message
    const assistantMessage: Message = {
      id: `temp-${Date.now()}`,
      content: "",
      role: "assistant",
    };
    setMessages((prev) => [...prev, assistantMessage]);

    // Create abort controller for the request
    const controller = new AbortController();
    setAbortController(controller);

    // Create a new SSE connection
    try {
      const response = await fetch("http://localhost:3000/streamChat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: input }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? { ...msg, content: data.response }
            : msg
        )
      );
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Fetch error:", err);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessage.id
              ? {
                  ...msg,
                  content:
                    msg.content + "\n\n**Error:** Failed to get response",
                }
              : msg
          )
        );
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  };

  const handleStop = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      setIsLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "90vh",
        width: "50%",
        bgcolor: "background.default",
      }}
    >
      {/* Messages container */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          p: 2,
          bgcolor: "background.paper",
        }}
      >
        <List>
          {messages.map((message) => (
            <ListItem
              key={message.id}
              alignItems="flex-start"
              sx={{
                flexDirection: message.role === "user" ? "row-reverse" : "row",
                mb: 2,
              }}
            >
              <ListItemAvatar>
                <Avatar
                  sx={{
                    bgcolor:
                      message.role === "user"
                        ? "primary.main"
                        : "secondary.main",
                  }}
                >
                  {message.role === "user" ? <Person /> : <SmartToy />}
                </Avatar>
              </ListItemAvatar>
              <Paper
                elevation={2}
                sx={{
                  p: 2,
                  maxWidth: "70%",
                  bgcolor:
                    message.role === "user"
                      ? "primary.light"
                      : "background.paper",
                  color:
                    message.role === "user"
                      ? "primary.contrastText"
                      : "text.primary",
                }}
              >
                {message.role === "user" ? (
                  <Typography>{message.content}</Typography>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={{
                      p({ node, children, ...props }) {
                        return (
                          <Typography paragraph {...props}>
                            {children}
                          </Typography>
                        );
                      },
                      code({ node, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const inline = !className?.includes("language-");

                        return inline ? (
                          <Box
                            component="code"
                            sx={{
                              bgcolor: "grey.200",
                              px: 0.5,
                              py: 0.2,
                              borderRadius: 1,
                              fontSize: "0.9em",
                            }}
                            {...props}
                          >
                            {children}
                          </Box>
                        ) : (
                          <Paper
                            elevation={0}
                            sx={{
                              bgcolor: "grey.900",
                              color: "common.white",
                              p: 1,
                              borderRadius: 1,
                              my: 1,
                            }}
                          >
                            <Typography
                              variant="caption"
                              sx={{ color: "grey.400" }}
                            >
                              {match?.[1] || "code"}
                            </Typography>
                            <Box
                              component="code"
                              className={className}
                              {...props}
                            >
                              {children}
                            </Box>
                          </Paper>
                        );
                      },
                      table({ node, children, ...props }) {
                        return (
                          <Box
                            sx={{
                              overflowX: "auto",
                              my: 2,
                            }}
                          >
                            <table
                              style={{
                                borderCollapse: "collapse",
                                width: "100%",
                              }}
                              {...props}
                            >
                              {children}
                            </table>
                          </Box>
                        );
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
              </Paper>
            </ListItem>
          ))}
          <div ref={messagesEndRef} />
        </List>
      </Box>

      {/* Input form */}
      <Paper
        component="form"
        onSubmit={handleSubmit}
        elevation={3}
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <TextField
          fullWidth
          variant="outlined"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
          multiline
          maxRows={4}
          sx={{
            bgcolor: "background.paper",
          }}
        />
        {isLoading ? (
          <>
            <IconButton
              color="error"
              onClick={handleStop}
              sx={{
                bgcolor: "error.main",
                color: "error.contrastText",
                "&:hover": {
                  bgcolor: "error.dark",
                },
              }}
            >
              <Stop />
            </IconButton>
            <CircularProgress size={24} />
          </>
        ) : (
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={!input.trim()}
            endIcon={<Send />}
            sx={{
              height: "56px", // Match TextField height
            }}
          >
            Send
          </Button>
        )}
      </Paper>
    </Box>
  );
};
