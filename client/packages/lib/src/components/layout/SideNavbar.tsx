import React from "react";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import HomeIcon from "@mui/icons-material/Home";
import InfoIcon from "@mui/icons-material/Info";
import SettingsIcon from "@mui/icons-material/Settings";
import { Box, IconButton, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

const drawerWidth = 240;

const menuItems = [
  { text: "Home", icon: <HomeIcon /> },
  { text: "About", icon: <InfoIcon /> },
  { text: "Settings", icon: <SettingsIcon /> },
];

import logo from "../../assets/logo.png";

interface SideNavbarProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SideNavbar: React.FC<SideNavbarProps> = ({ open, setOpen }) => {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: open ? drawerWidth : 60,
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: {
          width: open ? drawerWidth : 60,
          boxSizing: "border-box",
          transition: "width 0.2s",
        },
      }}
    >
      <Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "start",
            justifyContent: open ? "space-between" : "left",
            px: 2,
            py: 2,
          }}
        >
          {/* Logo (always visible) */}
          <Box
            sx={{
              display: "flex",
              alignItems: "start",
              cursor: !open ? "pointer" : "default",
            }}
            onClick={() => {
              if (!open) setOpen(true);
            }}
          >
            <img src={logo} alt="Logo" style={{ width: 24, height: 24 }} />
          </Box>
          {/* Close Icon (only when open) */}
          {open && (
            <IconButton size="small" onClick={() => setOpen(false)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
        <List sx={{ px: open ? 0 : 0.5 }}>
          {menuItems.map((item) => (
            <ListItem key={item.text} disablePadding sx={{ justifyContent: open ? 'initial' : 'center' }}>
              <Tooltip title={!open ? item.text : ""} placement="right" arrow disableHoverListener={open}>
                <ListItemButton
                  onClick={() => {
                    if (!open) setOpen(true);
                  }}
                  sx={{
                    minHeight: 48,
                    justifyContent: open ? 'initial' : 'center',
                    px: open ? 2 : 1,
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      mr: open ? 2 : 'auto',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {open && <ListItemText primary={item.text} />}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          ))}
        </List>
      </Box>
    </Drawer>
  );
};

export default SideNavbar;
