import { FormDialogBox } from "@/components/dialog-box/FormDialogBox";
import { Form } from "@/shadcn/ui/form";
import { useStoreAuth } from "@/store/useStoreAuth";
import { mediator } from "@/utils/mediator";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import z from "zod";
import { toast } from "sonner";
import { FormInput } from "@/components/formfields/FormInput";
import { FormTextArea } from "@/components/formfields/FormTextArea";
import { FormSelect } from "@/components/formfields/FormSelect";

const formSchema = z.object({
  botName: z
    .string({
      error: "Bot name is required.",
    })
    .min(3, {
      message: "Bot name must be at least 3 characters.",
    }),
  botDesc: z.string().min(3, {
    message: "Bot description must be at least 3 characters.",
  }),
  botType: z.string({
    error: "Please select bot type.",
  }),
});

export const CreateBotDialog = ({
  refreshData,
}: {
  refreshData: () => void;
}) => {
  const userProfile = useStoreAuth((state) => state.userProfile);
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      botName: "",
      botDesc: "",
    },
  });
  const handleSubmit = form.handleSubmit(async (values) => {
    console.log("Submitted:", values);
    try {
      await mediator.post("/bots", {
        owner: userProfile.email,
        ...values,
      });
      form.reset();
      setOpen(false); // ✅ close dialog on success
      toast("Bot created successfully.");
      refreshData();
    } catch (error: any) {
      console.error(error);
      toast("Bot created successfully.");
    }
  });

  return (
    <FormDialogBox
      title="Create Bot"
      triggerLabel="Create Bot"
      maxWidth="sm:max-w-xl"
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset();
      }}
      onSubmit={handleSubmit}
    >
      <Form {...form}>
        <form id="dialog-form" onSubmit={handleSubmit} className="space-y-6">
          <FormInput
            form={form}
            name="botName"
            label="Bot Name"
            placeHolder="what is your bot name?"
            gap={1}
          />

          <FormTextArea
            form={form}
            name="botDesc"
            label="Bot description"
            placeHolder="Tell me about your bot?"
            gap={1}
          />
          <FormSelect
            gap={1}
            form={form}
            label="Select bot type"
            name="botType"
            selectItems={[
              {
                value: "KB_Bot",
                label: "KB_Bot- Answer based on KB and General Knowledge",
              },
              {
                value: "General_Purpose",
                label: "Answer questions based on existing knowledge",
              },
            ]}
          />
        </form>
      </Form>
    </FormDialogBox>
  );
};
