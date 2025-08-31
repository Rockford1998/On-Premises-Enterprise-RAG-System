import { Container, Paper } from "@mui/material";
import { Footer } from "./Footer";
import { Outlet } from "react-router-dom";
import { Header } from "./Header";

export const Layout = () => {
  return (
    <Paper
      square={true}
      elevation={0}
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header />
      <Container
        maxWidth={false}
        component="main"
        sx={{ flex: 1, px: 1, pb: 1 }}
      >
        <Outlet />
      </Container>
      <Footer />
    </Paper>
  );
};
