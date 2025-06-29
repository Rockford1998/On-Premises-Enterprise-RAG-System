import { PageConstants } from "./constant/PageConstants";
import { Layout } from "./layout";
import { createBrowserRouter } from "react-router";
import { Settings } from "./pages/Settings";
import Chat from "./pages/Chat";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Chat /> },
      { path: PageConstants.settings.path, element: <Settings /> },
    ],
  },
]);
