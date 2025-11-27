import { PageWrapper } from "@/components/layout/PageWrapper";
import { useParams } from "react-router";
import { TabAgent } from "./tabs/TabAgent";
import { createContext, useContext, useEffect, useState } from "react";
import { mediator } from "@/utils/mediator";
import { Card, CardContent } from "@/shadcn/ui/card";

type AgentContextType = {
  botId: string | undefined;
};

const AgentContext = createContext<AgentContextType>({
  botId: undefined,
});

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
  [key: string]: any;
};

export const AgentsDetail = () => {
  const { id: botId } = useParams<{ id: string }>();
  const [bot, setBot] = useState<Bot | null>(null);

  useEffect(() => {
    if (!botId) return;

    (async () => {
      try {
        const res = await mediator.get(`/bots/${botId}`);
        setBot(res.data.data);
      } catch (err) {
        console.error("Failed to fetch bot:", err);
      }
    })();
  }, [botId]);

  return (
    <AgentContext.Provider value={{ botId }}>
      <PageWrapper title={bot?.botName ?? "Agent Details"}>
        {/* Compact Info Header */}
        <div className="flex gap-2 flex-wrap mb-3">
          {bot?.owner && (
            <Card className="rounded-md border p-0 shadow-sm">
              <CardContent className="p-2 py-1 text-xs">
                <span className="font-semibold">Owner:</span>{" "}
                {bot.owner.firstName} {bot.owner.lastName}
              </CardContent>
            </Card>
          )}
        </div>

        <TabAgent />
      </PageWrapper>
    </AgentContext.Provider>
  );
};
