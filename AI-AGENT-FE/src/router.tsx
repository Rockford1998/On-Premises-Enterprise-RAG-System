import { Layout } from "./layout";
import { Home } from "./pages/Home"; // Corrected import
import { Chat } from "./pages/Chat";
import { createBrowserRouter } from "react-router";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "/chat", element: <Chat /> },
      { path: "/settings", element: <Chat /> },
      { path: "/chat", element: <Chat /> },
    ],
  },
]);
