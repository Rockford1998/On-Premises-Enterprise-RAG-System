import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shadcn/ui/tabs";
import { Tabknowledge } from "./Tabknowledge";
import { TabBotForm } from "./TabBotForm";

export function TabAgent() {
  return (
    <div>
      {" "}
      {/* outer wrapper should have height */}
      <Tabs defaultValue="details" className="flex flex-col flex-1">
        {/* Tabs header */}
        <TabsList>
          <TabsTrigger value="details" className="cursor-pointer">
            Details
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="cursor-pointer">
            Knowledge
          </TabsTrigger>
        </TabsList>

        {/* Tabs content */}
        <TabsContent value="knowledge">
          <Tabknowledge />
        </TabsContent>

        <TabsContent value="details" className="h-[90vh]">
          <TabBotForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
