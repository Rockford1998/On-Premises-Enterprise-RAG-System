import { ThemeProvider } from "@emotion/react";
import { createTheme } from "@mui/material";
import {
  Layout,
  Notification,
  PageNotFound,
  ScrollbarStyles,
  useStoreThemeSwitcher,
} from "lib";
import { Home } from "./pages/home/Home";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

export const App = () => {
  const { mode } = useStoreThemeSwitcher();

  return (
    <BrowserRouter>
      <ThemeProvider
        theme={createTheme({
          palette: {
            mode: mode,
            primary: {
              main: "#848688",
            },
            secondary: {
              main: "#E37533",
            },
          },
          typography: {
            fontFamily: "Ubuntu",
          },
        })}
      >
        <Notification />
        {/* <ScrollbarStyles /> */}
        <Routes>
          <Route path="*" element={<PageNotFound />} />
          <Route path="/" element={<Navigate to="/app/home" />} />
          <Route path="/app" element={<Layout />}>
            <Route path="home" element={<Home />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  );
};
