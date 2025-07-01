import React, { useState } from "react";
import { Container, TextField, Button, Box } from "@mui/material";
import { ChatBotResponse } from "./ChatBotResponse";

export const SimpleChat = () => {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(input);
    setInput("");
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Box component="form" onSubmit={handleSubmit} sx={{ mb: 3 }}>
        <TextField
          fullWidth
          value={input}
          onChange={(e) => setInput(e.target.value)}
          label="Ask something..."
          variant="outlined"
        />
        <Button
          type="submit"
          variant="contained"
          sx={{ mt: 2 }}
          disabled={!input.trim()}
        >
          Send
        </Button>
      </Box>

      {query && <ChatBotResponse prompt={query} />}
    </Container>
  );
};
