import { PageWrapper } from "@/components/layout/PageWrapper";
import { useParams } from "react-router";
import { TabAgent } from "./tabs/TabAgent";
import { createContext, useContext, useEffect, useState } from "react";
import { mediator } from "@/utils/mediator";
import { Card, CardContent } from "@/shadcn/ui/card";

type AgentContextType = {
  botId: string;
};

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

export const AgentsDetail = () => {
  const { id: botId } = useParams<{ id: string }>();
  const [bot, setBot] = useState<Bot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!botId) return;

    (async () => {
      try {
        const res = await mediator.get(`/bots/${botId}`);
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
};
