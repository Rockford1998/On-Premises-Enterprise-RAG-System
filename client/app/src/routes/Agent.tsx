import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/Agent")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/Agent"!</div>;
}

