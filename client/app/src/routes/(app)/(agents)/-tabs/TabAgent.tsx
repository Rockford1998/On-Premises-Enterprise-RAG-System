import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shadcn/ui/tabs";
import { TabBotForm } from "./TabBotForm";
import { Tabknowledge } from "./Tabknowledge";
import { TabKnowledgeConnections } from "./TabKnowledgeConnections";
import { TabTools } from "./TabTools";

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
        {botType !== "General_Purpose" && (
          <TabsTrigger value="connections" className="px-3 py-1 text-xs">
            Knowledge Connections
          </TabsTrigger>
        )}
        <TabsTrigger value="tools" className="px-3 py-1 text-xs">
          Tools
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="details"
        className="flex-1 overflow-y-auto p-1 rounded-md"
      >
        <TabBotForm />
      </TabsContent>
      {botType !== "General_Purpose" && (
        <TabsContent
          value="knowledge"
          className="flex-1 overflow-y-auto p-1 rounded-md"
        >
          <Tabknowledge />
        </TabsContent>
      )}
      {botType !== "General_Purpose" && (
        <TabsContent
          value="connections"
          className="flex-1 overflow-y-auto p-1 rounded-md"
        >
          <TabKnowledgeConnections />
        </TabsContent>
      )}
      <TabsContent
        value="tools"
        className="flex-1 overflow-y-auto p-1 rounded-md"
      >
        <TabTools />
      </TabsContent>
    </Tabs>
  );
}
