import { BrowserRouter, Route, Routes } from "react-router-dom";
import UsersPage from "@/pages/UsersPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/users" element={<UsersPage />} />
      </Routes>
    </BrowserRouter>
  );
}
