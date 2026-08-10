import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageWrapper } from "@/routes/-components/layout/PageWrapper";
import { Avatar, AvatarFallback, AvatarImage } from "@/shadcn/ui/avatar";
import { Button } from "@/shadcn/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/shadcn/ui/card";
import { useStoreAuth } from "@/store/useStoreAuth";
import { starGate } from "@/utils/starGate";
import { MessageSquare, Settings } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/(app)/(hub)/hub-overview")({
  component: RouteComponent,
});

function RouteComponent() {
  const userProfile = useStoreAuth((state) => state.userProfile);
  const [bots, setBots] = useState<any>([]);
  const navigate = useNavigate();

  const ownerEmail = userProfile?.email;

  useEffect(() => {
    if (!ownerEmail) return;
    (async () => {
      const res = await starGate.get(`bots/owner/${ownerEmail}`);
      setBots(res.data.data);
    })();
  }, [ownerEmail]);

  return (
    <PageWrapper title="Your agents">
      <div className="flex flex-wrap gap-4 justify-start">
        {bots.map((bot: any) => (
          <Card key={bot.botId} className="w-56 p-0 flex-shrink-0">
            <CardHeader className="relative flex justify-center items-center p-2">
              {/* Avatar stays centered */}
              <Avatar className="h-12 w-12">
                <AvatarImage src="https://github.com/shadcn.png" />
                <AvatarFallback>BOT</AvatarFallback>
              </Avatar>

              {/* Settings button pinned to top-right */}
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 h-6 w-6 cursor-pointer"
                onClick={() => navigate({ to: `/agent-details/${bot.botId}` })}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </CardHeader>

            <CardContent className="flex flex-col justify-center items-center text-center gap-1">
              <h1 className="text-base font-semibold">{bot.botName}</h1>
              <p className="text-xs text-muted-foreground mt-2">
                {bot.botDesc}
              </p>

              <Button
                variant="outline"
                size="sm"
                className="mt-1 h-6 text-[11px] px-2 gap-1 rounded cursor-pointer"
                onClick={() => navigate({ to: `/chatbox/${bot.botId}` })}
              >
                <MessageSquare className="h-3 w-3" />
                Chat
              </Button>
            </CardContent>

            <CardFooter className="flex flex-col gap-1 text-xs">
              {/* Small footer actions */}
            </CardFooter>
          </Card>
        ))}
      </div>
    </PageWrapper>
  );
}
