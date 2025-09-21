import { PageWrapper } from "@/components/layout/PageWrapper";
import { useParams } from "react-router";
import { TabAgent } from "./tabs/TabAgent";
import { createContext, useContext, useEffect, useState } from "react";
import { mediator } from "@/utils/mediator";

type AgentContextType = {
  botId: string | undefined;
};

const AgentContext = createContext<AgentContextType>({
  botId: undefined,
});

export const useAgentContext = () => useContext(AgentContext);

type Bot = {
  _id: string;
  botName: string;
  botDesc?: string;
  [key: string]: any;
};

export const AgentsDetail = () => {
  const params = useParams<{ id: string }>();
  const botId = params.id;
  const [bot, setBot] = useState<Bot | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await mediator.get(`/bots/${botId}`);
        setBot(res.data);
      } catch (err) {
        console.error("Failed to fetch bot:", err);
      }
    })();
  }, [botId]);

  return (
    <PageWrapper title={bot?.botName ?? "Agent Details"}>
      <AgentContext.Provider value={{ botId }}>
        <TabAgent />
      </AgentContext.Provider>
    </PageWrapper>
  );
};
