// import { createBrowserRouter } from "react-router";
// import { Home } from "./pages/Home";
// import { RouterProvider } from "react-router/dom";
// import { Layout } from "./components/layout/Layout";
// import { ThemeProvider } from "./components/theme-provider/ThemeProvider";
// import { ProtectedRoute } from "./components/protected-route.tsx/ProtectedRoute";
// import { SignIn } from "./pages/auth/SignIn";
// import { BotHubOverview } from "./pages/bot-hub/BotHubOverview";
// import { ChatBox } from "./pages/chat/ChatBox";
// import { SignUp } from "./pages/auth/SignUp";
// import { AgentsOverview } from "./pages/Agents/AgentsOverview";
// import { AgentsDetail } from "./pages/Agents/AgentsDetail";

import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const App = () => {
  return <RouterProvider router={router} />;
};

export default App;
