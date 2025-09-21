import { createBrowserRouter } from "react-router";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { RouterProvider } from "react-router/dom";
import { Layout } from "./components/layout/Layout";
import { ThemeProvider } from "./components/theme-provider/ThemeProvider";
import { ProtectedRoute } from "./components/protected-route.tsx/ProtectedRoute";
import { Login } from "./pages/Login";
import { AgentsOverview } from "./pages/Agents/AgentsOverview";
import { AgentsDetail } from "./pages/Agents/AgentsDetail";

export const App = () => {
  const route = createBrowserRouter([
    {
      path: "/",
      element: (
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      ),
      children: [
        {
          index: true,
          path: "/",
          element: <Home />,
        },
        {
          path: "settings",
          element: <Settings />,
        },
        {
          path: "agents/overview",
          element: <AgentsOverview />,
        },
        {
          path: "agents/Detail/:id",
          element: <AgentsDetail />,
        },
      ],
    },
    {
      path: "/login",
      element: (
        <ProtectedRoute>
          <Login />
        </ProtectedRoute>
      ),
    },
  ]);
  return (
    <ThemeProvider>
      <RouterProvider router={route} />
    </ThemeProvider>
  );
};
