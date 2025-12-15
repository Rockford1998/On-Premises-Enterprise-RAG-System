import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/Hub')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/Hub"!</div>
}
