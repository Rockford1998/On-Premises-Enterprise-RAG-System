import { PageWrapper } from "@/components/layout/PageWrapper";
import { useParams } from "react-router";
import { TabAgent } from "./tabs/TabAgent";
import { createContext, useContext, useEffect, useState } from "react";
import { mediator } from "@/utils/mediator";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";

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
    <PageWrapper title={bot?.botName ?? "Agent Details"}>
      <div className="flex gap-3 flex-wrap mb-3 flex justify-start">
        <Card className="w-max h-10 m-0 p-1 rounded-md">
          <CardContent className="m-0 px-1">
            <strong>Owner:</strong> {bot?.owner?.firstName}{" "}
            {bot?.owner?.lastName}
          </CardContent>
        </Card>
        <Card className="w-max h-10 m-0 p-1 rounded-md">
          <CardContent className="m-0 px-1">
            <strong>Description:</strong> {bot?.botDesc}
          </CardContent>
        </Card>
      </div>

      <AgentContext.Provider value={{ botId }}>
        <TabAgent />
      </AgentContext.Provider>
    </PageWrapper>
  );
};
