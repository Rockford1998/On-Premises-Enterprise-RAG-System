import { createFileRoute } from "@tanstack/react-router";
import { PageWrapper } from "@/routes/-components/layout/PageWrapper";
import { createContext, useContext, useEffect, useState } from "react";
import { starGate } from "@/utils/starGate";
import { Card, CardContent } from "@/shadcn/ui/card";
import { TabAgent } from "./-tabs/TabAgent";

type AgentContextType = {
  botId: string;
};

export const Route = createFileRoute("/(app)/(agents)/agent-details/$botId")({
  component: AgentsDetail,
});

const AgentContext = createContext<AgentContextType>({} as AgentContextType);
export const useAgentContext = () => useContext(AgentContext);

type Owner = {
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
};

type Bot = {
  _id: string;
  botName: string;
  botDesc?: string;
  owner?: Owner;
  botType: string;
  [key: string]: any;
};

function AgentsDetail() {
  const { botId } = Route.useParams();
  const [bot, setBot] = useState<Bot | null>(null);
  const [error, setError] = useState<string | null>(null);
  console.log({ botId });
  useEffect(() => {
    if (!botId) return;

    (async () => {
      try {
        const res = await starGate.get(`/bots/${botId}`);
        setBot(res.data.data);
      } catch {
        setError("Failed to fetch bot");
      }
    })();
  }, [botId]);

  if (!bot) {
    return (
      <PageWrapper title="Loading...">
        <div className="py-8 text-sm">Loading agent information...</div>
      </PageWrapper>
    );
  }

  return (
    <AgentContext.Provider value={{ botId }}>
      <PageWrapper title={bot.botName}>
        <div className="flex gap-2 flex-wrap mb-3">
          {error && (
            <Card className="border-destructive">
              <CardContent className="p-2 text-sm text-red-600">
                {error}
              </CardContent>
            </Card>
          )}

          {bot.owner && (
            <Card className="rounded-md border shadow-sm">
              <CardContent className="p-3 text-sm flex flex-col">
                <span className="font-semibold">
                  {bot.owner.firstName} {bot.owner.lastName}
                </span>
                <span className="text-muted-foreground text-xs">
                  {bot.owner.email}
                </span>
              </CardContent>
            </Card>
          )}
        </div>

        <TabAgent botType={bot.botType} />
      </PageWrapper>
    </AgentContext.Provider>
  );
}
