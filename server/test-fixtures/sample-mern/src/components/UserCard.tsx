type UserCardProps = { name: string; email: string };

export default function UserCard({ name, email }: UserCardProps) {
  return (
    <div>
      <h3>{name}</h3>
      <p>{email}</p>
    </div>
  );
}
