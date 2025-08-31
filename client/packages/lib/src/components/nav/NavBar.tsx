import { useState, useEffect, useRef } from "react";
import {
  Button,
  Menu,
  MenuItem,
  Box,
  Typography,
  Tooltip,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ArrowLeftIcon from "@mui/icons-material/ArrowLeft";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { Link, useLocation } from "react-router-dom";
import type { NavItemProps } from "../../constants";

interface NavbarProps {
  navItems: NavItemProps[];
}

export const Navbar = ({ navItems }: NavbarProps) => {
  const location = useLocation();
  const navRef = useRef<HTMLDivElement>(null);
  const [visibleItems, setVisibleItems] = useState<NavItemProps[]>([]);
  const [overflowItems, setOverflowItems] = useState<NavItemProps[]>([]);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(
    null
  );
  const [submenuAnchor, setSubmenuAnchor] = useState<null | HTMLElement>(null);
  const [submenuItems, setSubmenuItems] = useState<NavItemProps[] | null>(null);
  const handleMoreMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setMoreMenuAnchor(event.currentTarget);
  };

  const handleMoreMenuClose = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setMoreMenuAnchor(null);
  };

  const handleSubmenuOpen = (
    event: React.MouseEvent<HTMLElement>,
    items: NavItemProps[]
  ) => {
    event.stopPropagation();
    setSubmenuAnchor(event.currentTarget);
    setSubmenuItems(items);
  };

  const handleSubmenuClose = () => {
    setSubmenuAnchor(null);
    setSubmenuItems(null);
  };

  return (
    <Box
      component="nav"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "text.secondary",
        height: 52,
        width: "100%",
        gap: 0.5,
        px: 1,
      }}
    >
      <Box
        ref={navRef}
        sx={{
          display: "flex",
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "flex-end",
          overflow: "hidden",
          width: "100%",
          height: "100%",
          gap: 0.5,
        }}
      >
        {visibleItems.map((item, index) => {
          const isActive =
            location.pathname === item.to ||
            location.pathname.includes(item.include || "xyz");
          const hasActiveSubitem = item.items?.some(
            (subItem) =>
              location.pathname === subItem.to ||
              location.pathname.includes(subItem.include || "")
          );

          return item.items ? (
            <Box
              key={item.to || item.label}
              sx={{
                py: 1,
                height: "100%",
                borderBottom: hasActiveSubitem ? "3px solid" : "none",
                borderColor: "secondary.main",
              }}
            >
              <Button
                key={index}
                color="inherit"
                sx={{
                  color: hasActiveSubitem ? "secondary.main" : "inherit",
                  ":hover": {
                    color: "secondary.main",
                  },
                }}
                onClick={(e) => handleSubmenuOpen(e, item.items!)}
              >
                {item.label} <ArrowDropDownIcon fontSize="small" />
              </Button>
            </Box>
          ) : (
            <Box
              key={item.to || item.label}
              sx={{
                py: 1,
                height: "100%",
                borderBottom: isActive ? "3px solid" : "none",
                borderColor: "secondary.main",
              }}
            >
              <Button
                key={index}
                component={Link}
                to={item.to || "#"}
                color="inherit"
                sx={{
                  color: isActive ? "secondary.main" : "inherit",
                  ":hover": {
                    color: "secondary.main",
                  },
                }}
              >
                {item.label}
              </Button>
            </Box>
          );
        })}
      </Box>

      {overflowItems.length > 0 && (
        <>
          <Tooltip arrow title={"More"} disableInteractive>
            <Button
              color="inherit"
              onClick={handleMoreMenuOpen}
              sx={{
                minWidth: 0,
                ":hover": {
                  color: "secondary.main",
                },
              }}
            >
              <MoreVertIcon fontSize="medium" />
            </Button>
          </Tooltip>
          <Menu
            anchorEl={moreMenuAnchor}
            open={Boolean(moreMenuAnchor)}
            onClose={handleMoreMenuClose}
            MenuListProps={{ sx: { p: 0 } }}
            sx={{ mt: 0.5 }}
          >
            {overflowItems.map((item) => {
              const hasActiveSubitem = item.items?.some(
                (subItem) =>
                  location.pathname === subItem.to ||
                  location.pathname.includes(subItem.include || "")
              );

              return item.items ? (
                <MenuItem
                  key={item.to || item.label}
                  onClick={(e) => handleSubmenuOpen(e, item.items!)}
                  sx={{
                    p: 0,
                    borderBottom: hasActiveSubitem ? "3px solid" : "none",
                    borderColor: "secondary.main",
                    color: hasActiveSubitem ? "secondary.main" : "inherit",
                    ":hover": {
                      color: "secondary.main",
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      p: 1,
                    }}
                  >
                    <ArrowLeftIcon fontSize="small" />
                    <Typography variant="button" color="inherit">
                      {item.label}
                    </Typography>
                  </Box>
                </MenuItem>
              ) : (
                <MenuItem
                  key={item.to || item.label}
                  component={Link}
                  to={item.to || "#"}
                  onClick={handleMoreMenuClose}
                  sx={{
                    p: 0,
                    borderBottom:
                      location.pathname === item.to ? "3px solid" : "none",
                    borderColor: "secondary.main",
                    color:
                      location.pathname === item.to
                        ? "secondary.main"
                        : "inherit",
                    ":hover": {
                      color: "secondary.main",
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      width: "100%",
                      p: 1,
                    }}
                  >
                    <Typography variant="button" color="inherit">
                      {item.label}
                    </Typography>
                  </Box>
                </MenuItem>
              );
            })}
          </Menu>
        </>
      )}

      {submenuItems && (
        <Menu
          anchorEl={submenuAnchor}
          open={Boolean(submenuAnchor)}
          onClose={handleSubmenuClose}
          MenuListProps={{ sx: { p: 0 } }}
          anchorOrigin={{
            vertical: moreMenuAnchor === null ? "bottom" : "top",
            horizontal: "left",
          }}
          transformOrigin={{
            vertical: "top",
            horizontal: moreMenuAnchor === null ? "left" : "right",
          }}
          sx={{
            // mt: moreMenuAnchor === null ? 0.5 : 0,
            mr: 0.5,
          }}
        >
          {submenuItems.map((subItem, subIndex) => {
            const isActive =
              location.pathname === subItem.to ||
              location.pathname.includes(subItem.include || "");
            return (
              <MenuItem
                key={subIndex}
                component={Link}
                to={subItem.to || "#"}
                onClick={(e) => {
                  handleSubmenuClose();
                  handleMoreMenuClose(e);
                }}
                sx={{
                  borderBottom: isActive ? "3px solid" : "none",
                  borderColor: "secondary.main",
                  color: isActive ? "secondary.main" : "text.secondary",
                  ":hover": {
                    color: "secondary.main",
                  },
                }}
              >
                <Typography variant="button" color="inherit">
                  {subItem.label}
                </Typography>
              </MenuItem>
            );
          })}
        </Menu>
      )}
    </Box>
  );
};
