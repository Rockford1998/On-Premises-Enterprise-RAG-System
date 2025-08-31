import { Box, Typography, Button } from "@mui/material";
import DangerousOutlinedIcon from "@mui/icons-material/DangerousOutlined";
import { useNavigate } from "react-router-dom";

export const PageNotFound = () => {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        textAlign: "center",
        color: "text.primary",
        gap: 1,
        px: 2,
        py: 4,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "error.main",
          fontSize: { xs: 80, sm: 120 },
        }}
      >
        <DangerousOutlinedIcon sx={{ fontSize: "inherit", m: 0, p: 0 }} />
      </Box>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: "100%",
          gap: 2,
        }}
      >
        <Typography
          variant="h1"
          fontWeight={800}
          color="error.dark"
          sx={{
            fontSize: { xs: "3rem", sm: "4rem" },
            textShadow: "2px 2px 10px rgba(0,0,0,0.1)",
          }}
        >
          404
        </Typography>

        <Typography
          variant="h5"
          sx={{ fontSize: { xs: "1.2rem", sm: "1.5rem" } }}
        >
          Oops! You seem lost.
        </Typography>

        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ fontSize: { xs: "1rem", sm: "1.2rem" } }}
        >
          The page you're looking for doesn’t exist or might have been moved.
        </Typography>

        <Button
          variant="contained"
          color="secondary"
          onClick={() => navigate("/")}
          sx={{
            fontWeight: "bold",
            borderRadius: "8px",
            px: 2,
            py: 1,
            boxShadow: 3,
            transition: "all 0.3s ease-in-out",
            "&:hover": {
              boxShadow: 6,
              transform: "scale(1.05)",
            },
          }}
        >
          Go Home
        </Button>
      </Box>
    </Box>
  );
};
