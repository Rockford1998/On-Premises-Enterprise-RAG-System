import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shadcn/ui/tabs";
import { TabBotForm } from "./TabBotForm";
import { Tabknowledge } from "./Tabknowledge";

export function TabAgent({ botType }: { botType: string }) {
  return (
    <Tabs defaultValue="details" className="flex flex-col flex-1 w-full h-full">
      {/* Header */}
      <TabsList className="w-fit mb-2">
        <TabsTrigger value="details" className="px-3 py-1 text-xs">
          Details
        </TabsTrigger>
        {botType !== "General_Purpose" && (
          <TabsTrigger value="knowledge" className="px-3 py-1 text-xs">
            Knowledge
          </TabsTrigger>
        )}
      </TabsList>

      {/* Details Tab */}
      <TabsContent
        value="details"
        className="flex-1 overflow-y-auto p-1 rounded-md"
      >
        <TabBotForm />
      </TabsContent>

      {/* Knowledge Tab */}
      {botType !== "General_Purpose" && (
        <TabsContent
          value="knowledge"
          className="flex-1 overflow-y-auto p-1 rounded-md"
        >
          <Tabknowledge />
        </TabsContent>
      )}
    </Tabs>
  );
}
