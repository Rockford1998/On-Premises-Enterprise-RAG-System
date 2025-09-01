import { ThemeProvider } from "@emotion/react";
import { createTheme } from "@mui/material";
import {
  CONST_PAGE_ROUTES,
  Layout,
  Notification,
  PageNotFound,
  ProtectedRoute,
  ScrollbarStyles,
  useStoreThemeSwitcher,
} from "lib";
import { Home } from "./pages/home/Home";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import SignIn from "lib/src/pages/SignIn";
import SignUp from "lib/src/pages/SignUp";

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
        <ScrollbarStyles />
        <Routes>
          <Route path={CONST_PAGE_ROUTES.SignIn} element={<SignIn />} />
          <Route path={CONST_PAGE_ROUTES.SignUp} element={<SignUp />} />
          <Route path="/" element={<Navigate to="/app/home" />} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="home" element={<Home />} />
          </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  );
};
