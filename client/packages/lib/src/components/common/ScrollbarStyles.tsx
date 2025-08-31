import { GlobalStyles, useTheme } from "@mui/material";

export const ScrollbarStyles = () => {
  const theme = useTheme();

  return (
    <GlobalStyles
      styles={{
        /* Default Scrollbar Styles */
        "::-webkit-scrollbar-track": {
          background: "transparent",
        },
        "::-webkit-scrollbar": {
          width: "8px",
          height: "8px",
        },
        "::-webkit-scrollbar-thumb": {
          background: theme.palette.mode === "dark" ? "#555" : "#aaa",
          borderRadius: "2px",
        },
        "::-webkit-scrollbar-thumb:hover": {
          background: theme.palette.mode === "dark" ? "#777" : "#888",
        },
        "*": {
          scrollbarWidth: "thin",
          scrollbarColor: `${theme.palette.mode === "dark" ? "#555" : "#aaa"} ${
            theme.palette.background.default
          }`,
        },

        /* 🔥 Hide Scrollbars for Elements with .hidden-scrollbar */
        ".hidden-scrollbar": {
          scrollbarHeight: "none",
          scrollbarWidth: "none", // Firefox
        },
        ".hidden-scrollbar::-webkit-scrollbar": {
          display: "none", // Chrome/Safari
        },
      }}
    />
  );
};
