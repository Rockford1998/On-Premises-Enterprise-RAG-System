import React, { useState } from "react";
import {
  Menu,
  MenuItem,
  Avatar,
  Typography,
  Divider,
  Box,
  Paper,
  Button,
  Link,
} from "@mui/material";
import {
  Logout,
  LightModeOutlined,
  DarkModeOutlined,
  ArrowDropDown,
} from "@mui/icons-material";
import { useStoreAuth } from "../../store/useStoreAuth";
import { useStoreNotification } from "../notifications";
import { useStoreThemeSwitcher } from "../../store";
import { useNavigate } from "react-router-dom";

export const MenuUserProfile = () => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { mode, toggleMode } = useStoreThemeSwitcher();
  const userProfile = useStoreAuth((state) => state.userProfile);
  const navigate = useNavigate();

  const notifySuccess = useStoreNotification((state) => state.notifySuccess);
  const notifyError = useStoreNotification((state) => state.notifyError);
  const logOut = useStoreAuth((state) => state.logOut);

  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <Box>
      <Button
        onClick={handleClick}
        sx={{ minWidth: 0, ":hover": { color: "secondary.main" } }}
      >
        <Avatar sx={{ width: 22, height: 22 }} />
        <ArrowDropDown fontSize="small" />
      </Button>

      <Menu
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        disableScrollLock={true}
        slotProps={{
          paper: {
            elevation: 3,
            sx: {
              width: 250,
              maxHeight: "fit-content",
              borderRadius: 2,
              px: 1,
            },
          },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: { xs: "center", sm: "flex-start" },
            flexDirection: { xs: "column", sm: "row" },
            textAlign: { xs: "center", sm: "left" },
            gap: 2,
            p: 1,
          }}
        >
          <Avatar
            sx={{ width: { xs: 35, sm: 50 }, height: { xs: 35, sm: 50 } }}
          />
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              width: "inherit",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <Typography variant="subtitle2" fontWeight={600}>
              {userProfile?.firstName} {userProfile?.lastName}
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
              textOverflow={"ellipsis"}
            >
              {userProfile?.jobTitle
                ? userProfile.jobTitle.split("_").join(" ")
                : "Job Title Unvailable"}
            </Typography>

            <Typography variant="caption" color="text.secondary" noWrap>
              <Link sx={{ color: "inherit" }} underline="hover">
                Email
              </Link>
            </Typography>
          </Box>
        </Paper>

        <Divider sx={{ my: 1 }} />

        <Box
          sx={{
            display: "flex",
            width: "100%",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <MenuItem
            sx={{ flex: 1, borderRadius: 1, width: "100%", minHeight: 20 }}
            onClick={toggleMode}
          >
            {mode === "light" ? (
              <>
                <DarkModeOutlined sx={{ mr: 1.5, fontSize: 16 }} />
                <Typography variant="body2">Dark</Typography>
              </>
            ) : (
              <>
                <LightModeOutlined sx={{ mr: 1.5, fontSize: 16 }} />
                <Typography variant="body2">Light</Typography>
              </>
            )}
          </MenuItem>
          <MenuItem
            sx={{ flex: 1, borderRadius: 1, width: "100%", minHeight: 20 }}
          >
            <Logout fontSize="small" sx={{ fontSize: 16, mr: 1.5 }} />
            <Typography variant="body2">Logout</Typography>
          </MenuItem>
        </Box>
      </Menu>
    </Box>
  );
};
