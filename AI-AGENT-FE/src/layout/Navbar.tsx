import React from "react";
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import HomeIcon from "@mui/icons-material/Home";
import SettingsIcon from "@mui/icons-material/Settings";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import InfoIcon from "@mui/icons-material/Info";
import { Link, NavLink } from "react-router";

const navItems = [
  { label: "Home", to: "/", icon: <HomeIcon /> },
  { label: "Chat", to: "/chat", icon: <RateReviewOutlinedIcon /> },
  { label: "Settings", to: "/settings", icon: <SettingsIcon /> },
  { label: "About", to: "/about", icon: <InfoIcon /> },
];

export const DRAWER_WIDTH_OPEN = 150; // Width when drawer is open
export const DRAWER_WIDTH_CLOSED = 60;

export const Navbar = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  return (
    <Drawer
      variant="permanent"
      open={open}
      PaperProps={{
        sx: {
          width: open ? DRAWER_WIDTH_OPEN : DRAWER_WIDTH_CLOSED,
          transition: "width 0.3s",
          overflowX: "hidden",
          backgroundColor: "#fff",
          position: "fixed",
          left: 0,
          top: 0,
          height: "100vh",
          borderRight: "1px solid #e0e0e0",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: open ? "flex-end" : "center",
          p: 1,
        }}
      >
        <IconButton onClick={() => setOpen((prev) => !prev)}>
          <MenuIcon />
        </IconButton>
      </Box>
      <List>
        {navItems.map((item) => (
          <ListItem
            component={NavLink}
            key={item.label}
            disablePadding
            sx={{ display: "flex" }}
            to={item.to}
            style={{ textDecoration: "none", color: "inherit", margin: 13 }}
          >
            <ListItemIcon
              sx={{
                minWidth: 0,
                mr: open ? 2 : "auto",
                justifyContent: "center",
              }}
            >
              {item.icon}
            </ListItemIcon>
            {open && <ListItemText primary={item.label} />}
            <Divider variant="inset" component="li" />
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
};
