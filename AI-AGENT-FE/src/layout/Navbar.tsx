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
import { NavLink } from "react-router";
import { PageConstants, type PageType } from "../constant/PageConstants";

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
        }}
      >
        <IconButton onClick={() => setOpen((prev) => !prev)}>
          <MenuIcon />
        </IconButton>
      </Box>
      <List
        sx={{
          padding: 0,
        }}
      >
        {Object.keys(PageConstants).map((key) => (
          <ListItem
            component={NavLink}
            key={key}
            disablePadding
            sx={{
              display: "flex",
              my: 1, // vertical margin between items
              mx: 2, // horizontal margin if needed
              borderRadius: 2,
            }}
            to={PageConstants[key as PageType].to}
            style={{
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 0,
                mr: 2,
                justifyContent: "center",
              }}
            >
              {PageConstants[key as PageType].icon}
            </ListItemIcon>
            {open && (
              <ListItemText primary={PageConstants[key as PageType].label} />
            )}
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
};
