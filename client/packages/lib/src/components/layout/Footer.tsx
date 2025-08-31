import { Box, Typography } from "@mui/material";

export const Footer = () => (
  <Box
    component="footer"
    sx={{
      width: "100%",
      borderTop: (theme) => `1px solid ${theme.palette.divider}`,
      bgcolor: "background.paper",
      py: 1,
    }}
  >
    <Box
      sx={{
        mx: "auto",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        px: 2,
      }}
    >
      <Box
        sx={{
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <Typography variant="caption" color="text.secondary" noWrap>
          © {new Date().getFullYear()} Rockford
        </Typography>
      </Box>
    </Box>
  </Box>
);
