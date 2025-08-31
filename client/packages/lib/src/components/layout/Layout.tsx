import { Paper, Box } from "@mui/material";

import { Footer } from "./Footer";
import { Outlet } from "react-router-dom";
import { Header } from "./Header";

import { useState } from "react";
import SideNavbar from "./SideNavbar";

export const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarWidth = sidebarOpen ? 240 : 60;
  return (
    <Paper
      square={true}
      elevation={0}
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* Sidebar Section */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: sidebarWidth,
          maxWidth: sidebarWidth,
          width: sidebarWidth,
          height: "100vh",
          bgcolor: "background.paper",
          boxShadow: 1,
          transition: "all 0.2s",
        }}
      >
        <SideNavbar open={sidebarOpen} setOpen={setSidebarOpen} />
      </Box>
      {/* Main Section */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          height: "100vh",
          minWidth: 0,
          transition: "all 0.2s",
        }}
      >
        <Header />
        <Box component="main" sx={{ flex: 1, px: 1, pb: 1, overflow: "auto" }}>
          <Outlet />
        </Box>
        <Footer />
      </Box>
    </Paper>
  );
};
