import { FormDialogBox } from "@/components/dialog-box/FormDialogBox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shadcn/ui/form";
import { Input } from "@/shadcn/ui/input";
import { Textarea } from "@/shadcn/ui/textarea";
import { useStoreAuth } from "@/store/useStoreAuth";
import { mediator } from "@/utils/mediator";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import z from "zod";
import { toast } from "sonner";

const formSchema = z.object({
  botName: z.string().min(3, {
    message: "Bot name must be at least 3 characters.",
  }),
  botDesc: z.string().min(3, {
    message: "Bot description must be at least 3 characters.",
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
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset();
      }}
      onSubmit={handleSubmit}
    >
      <Form {...form}>
        <form id="dialog-form" onSubmit={handleSubmit} className="space-y-6">
          <FormField
            control={form.control}
            name="botName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bot name</FormLabel>
                <FormControl>
                  <Input placeholder="Bot name" {...field} />
                </FormControl>
                <FormMessage className="m-0" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="botDesc"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bot description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Bot description"
                    className="resize-none"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="m-0" />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </FormDialogBox>
  );
};
