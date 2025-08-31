import { Box, Divider, Link } from "@mui/material";
import { Navbar } from "../nav/NavBar";
import { Link as RouterLink } from "react-router-dom";
import { navItems } from "../../constants";

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
      {/* Logo Section */}
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Link
          component={RouterLink}
          to="/app/home"
          underline="none"
          sx={{
            display: "flex",
            alignItems: "center",
            p: 1,
            "& img": { height: 36 },
          }}
        >
          <img alt="Logo" />
        </Link>
      </Box>

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
      ></Box>
    </Box>
  );
};
