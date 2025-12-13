import { createBrowserRouter } from "react-router";
import { Home } from "./pages/Home";
import { RouterProvider } from "react-router/dom";
import { Layout } from "./components/layout/Layout";
import { ThemeProvider } from "./components/theme-provider/ThemeProvider";
import { ProtectedRoute } from "./components/protected-route.tsx/ProtectedRoute";
import { SignIn } from "./pages/auth/SignIn";
import { AgentsOverview } from "./pages/agents/AgentsOverview";
import { AgentsDetail } from "./pages/agents/AgentsDetail";
import { BotHubOverview } from "./pages/bot-hub/BotHubOverview";
import { ChatBox } from "./pages/chat/ChatBox";
import { SignUp } from "./pages/auth/SignUp";


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
          path: "/hub",
          element: <BotHubOverview />,
        },
        {
          path: "agents/overview",
          element: <AgentsOverview />,
        },
        {
          path: "agents/Detail/:id",
          element: <AgentsDetail />,
        },
        {
          path: "agents/chat/:botId",
          element: <ChatBox />,
        },
      ],
    },
    {
      path: "/signin",
      element: (
        <ProtectedRoute>
          <SignIn />
        </ProtectedRoute>
      ),
    },
    {
      path: "/signup",
      element: <SignUp />,
    },
  ]);
  return (
    <ThemeProvider>
      <RouterProvider router={route} />
    </ThemeProvider>
  );
};
