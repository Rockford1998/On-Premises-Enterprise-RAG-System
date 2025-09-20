import { PageWrapper } from "@/components/layout/PageWrapper";
import { Button } from "@/shadcn/ui/button";
import { columns, type Payment } from "./Columns";
import { DataTable } from "./DataTable";
import { Separator } from "@/shadcn/ui/separator";
import { ExampleForm } from "./ExampleForm";
import z from "zod";
import { CreateBotDialog } from "./bot-hub/CreateBotDialog";

export const Home = () => {
  const { payments } = useHome();
  return (
    <PageWrapper
      title="Home"
      actions={
        <Button variant={"outline"} size={"sm"} className="cursor-pointer">
          Action button
        </Button>
      }
    >
      <CreateBotDialog />
      <Separator />
      <h4>Table</h4>
      <div>
        <DataTable columns={columns} data={payments} />
      </div>
      <Separator />
      <div className="space-y-4">
        <h4>form</h4>
        <ExampleForm />
      </div>
    </PageWrapper>
  );
};

const useHome = () => {
  const payments: Payment[] = [
    {
      id: "728ed52f",
      amount: 100,
      status: "pending",
      email: "m@example.com",
    },
    {
      id: "489e1d42",
      amount: 125,
      status: "processing",
      email: "example@gmail.com",
    },
    {
      id: "a3b9c8e1",
      amount: 200,
      status: "success",
      email: "a@example.com",
    },
    {
      id: "f4d5e6b7",
      amount: 50,
      status: "failed",
      email: "b@example.com",
    },
    // ...
  ];
  return { payments };
};

const formSchema = z.object({
  botName: z.string().min(3, {
    message: "Bot name must be at least 3 characters.",
  }),
  botDesc: z.string().min(3, {
    message: "Bot description must be at least 3 characters.",
  }),
});
