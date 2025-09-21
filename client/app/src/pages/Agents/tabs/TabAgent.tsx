import { Button } from "@/shadcn/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shadcn/ui/card";
import { Input } from "@/shadcn/ui/input";
import { Label } from "@/shadcn/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shadcn/ui/tabs";
import { Tabknowledge } from "./Tabknowledge";

export function TabAgent() {
  return (
    <div className="h-full flex flex-col">
      {" "}
      {/* outer wrapper should have height */}
      <Tabs defaultValue="knowledge" className="flex flex-col flex-1">
        {/* Tabs header */}
        <TabsList>
          <TabsTrigger value="knowledge" className="cursor-pointer">
            Knowledge
          </TabsTrigger>
          <TabsTrigger value="password" className="cursor-pointer">
            Password
          </TabsTrigger>
        </TabsList>

        {/* Tabs content */}
        <TabsContent value="knowledge" className="flex-1 flex flex-col">
          <Tabknowledge />
        </TabsContent>

        <TabsContent value="password" className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col">
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>
                Change your password here. After saving, you&apos;ll be logged
                out.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 flex-1">
              <div className="grid gap-3">
                <Label htmlFor="tabs-demo-current">Current password</Label>
                <Input id="tabs-demo-current" type="password" />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="tabs-demo-new">New password</Label>
                <Input id="tabs-demo-new" type="password" />
              </div>
            </CardContent>
            <CardFooter>
              <Button>Save password</Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
