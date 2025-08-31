import { Box, Link } from "@mui/material";
import { Navbar } from "../nav/NavBar";
import { Link as RouterLink } from "react-router-dom";
import { navItems } from "../../constants";
import { MenuUserProfile } from "../menus";

export const Header = () => {
  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        bgcolor: "background.paper",
        px: 1.5,
        minHeight: 50,
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
      }}
    >
      {/* Navbar */}
      <Box sx={{ flexGrow: 1, display: "flex", justifyContent: "center" }}>
        <Navbar navItems={navItems} />
      </Box>

      {/* User Profile & Divider */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <MenuUserProfile />
      </Box>
    </Box>
  );
};
