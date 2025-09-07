import { createBrowserRouter } from "react-router";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { RouterProvider } from "react-router/dom";
import { Layout } from "./components/layout/Layout";

export const App = () => {
  const route = createBrowserRouter([
    {
      path: "/",
      element: <Layout />,
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
      ],
    },
  ]);

  return <RouterProvider router={route} />;
};

