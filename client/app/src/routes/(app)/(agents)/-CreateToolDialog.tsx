import { FormDialogBox } from "@/routes/-components/dialog-box/FormDialogBox";
import { FormInput } from "@/routes/-components/formfields/FormInput";
import { FormSelect } from "@/routes/-components/formfields/FormSelect";
import { FormTextArea } from "@/routes/-components/formfields/FormTextArea";
import { Form } from "@/shadcn/ui/form";
import { starGate } from "@/utils/starGate";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";

export const CreateToolDialog = ({
  refreshData,
  botId,
}: {
  refreshData: () => void;
  botId: string;
}) => {
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      type: "API",
    },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      const payload = {
        botId: botId,
        ...values,
      };
      console.log(payload);
      await starGate.post("/tools", payload);

      form.reset();
      setOpen(false);
      toast("Tool created successfully.");
      refreshData();
    } catch (error) {
      console.error(error);
      toast("Failed to create tool.");
    }
  });

  return (
    <FormDialogBox
      title="Create Tool"
      triggerLabel="Create Tool"
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
            name="name"
            label="Tool Name"
            placeHolder="Enter tool name"
            gap={1}
          />

          <FormTextArea
            form={form}
            name="description"
            label="Tool Description"
            placeHolder="Describe the tool"
            gap={1}
          />

          <FormSelect
            gap={1}
            form={form}
            label="Tool Type"
            name="type"
            selectItems={[
              {
                value: "API",
                label: "API",
              },
              {
                value: "DATABASE",
                label: "DATABASE",
              },
            ]}
          />
        </form>
      </Form>
    </FormDialogBox>
  );
};

const formSchema = z.object({
  name: z
    .string({
      error: "Name is required.",
    })
    .min(3, {
      message: "Name must be at least 3 characters.",
    }),

  description: z.string().min(3, {
    message: "Description must be at least 3 characters.",
  }),

  type: z.enum(["API", "DATABASE"], {
    error: "Please select tool type.",
  }),
});
