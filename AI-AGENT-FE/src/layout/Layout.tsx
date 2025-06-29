import { Box } from "@mui/material";
import { useState } from "react";
import { DRAWER_WIDTH_CLOSED, DRAWER_WIDTH_OPEN, Navbar } from "./Navbar";
import { Outlet } from "react-router";

export const Layout = () => {
  const [open, setOpen] = useState(true);

  return (
    <Box display="flex" minHeight="100vh" width="100%" bgcolor="blueviolet">
      <Navbar open={open} setOpen={setOpen} />
      <Box
        component="main"
        sx={{
          flex: 1,
          minWidth: 0,
          ml: `${open ? DRAWER_WIDTH_OPEN : DRAWER_WIDTH_CLOSED}px`,
          transition: "margin-left 0.3s",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box height={25}>header</Box>
        <Box
          flex={1}
          overflow="auto"
          bgcolor="#f0f0f0"
          display={"flex"}
          alignItems={"center"}
          justifyContent={"center"}
        >
          <Outlet />
        </Box>
        <Box>Footer</Box>
      </Box>
    </Box>
  );
};
