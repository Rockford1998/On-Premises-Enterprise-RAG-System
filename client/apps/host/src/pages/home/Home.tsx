import { Box, Typography } from "@mui/material";
import { PageWrap } from "lib";

export const Home = () => {
  return (
    <PageWrap>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "70dvh",
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <Typography variant="h2" color="secondary">
          WELCOME TO DOYEN CONTROL CENTER
        </Typography>
        <Typography variant="h6" color="primary">
          * we will add widgets here later
        </Typography>
      </Box>
    </PageWrap>
  );
};
