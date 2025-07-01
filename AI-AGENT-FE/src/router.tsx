import { PageConstants } from "./constant/PageConstants";
import { Layout } from "./layout";
import { createBrowserRouter } from "react-router";
import { Settings } from "./pages/Settings";
import { SimpleChat } from "./pages/SimpleChat";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <SimpleChat /> },
      { path: PageConstants.settings.path, element: <Settings /> },
    ],
  },
]);
