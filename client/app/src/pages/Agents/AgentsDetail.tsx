import { PageWrapper } from "@/components/layout/PageWrapper";
import { useParams } from "react-router";
import { TabAgent } from "./tabs/TabAgent";
import { createContext, useContext } from "react";

type AgentContextType = {
  botId: string | undefined;
};

const AgentContext = createContext<AgentContextType>({
  botId: undefined,
});

export const useAgentContext = () => useContext(AgentContext);

export const AgentsDetail = () => {
  const params = useParams();

  return (
    <PageWrapper title="Agents">
      <AgentContext.Provider value={{ botId: params.id }}>
        <TabAgent />
      </AgentContext.Provider>
    </PageWrapper>
  );
};
