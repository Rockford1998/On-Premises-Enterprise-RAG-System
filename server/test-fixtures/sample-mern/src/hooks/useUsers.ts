import { useEffect, useState } from "react";
import axios from "axios";

export type User = { name: string; email: string };

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    axios.get("/api/users").then((res) => setUsers(res.data));
  }, []);

  return { users };
}
