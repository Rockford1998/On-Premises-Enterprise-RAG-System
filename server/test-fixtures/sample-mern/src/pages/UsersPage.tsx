import { useUsers } from "@/hooks/useUsers";
import UserCard from "@/components/UserCard";

export default function UsersPage() {
  const { users } = useUsers();
  return (
    <div>
      {users.map((user) => (
        <UserCard key={user.email} name={user.name} email={user.email} />
      ))}
    </div>
  );
}
