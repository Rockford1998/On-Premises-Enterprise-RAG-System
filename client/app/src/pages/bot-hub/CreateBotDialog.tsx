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
import z from "zod";

const formSchema = z.object({
  botName: z.string().min(3, {
    message: "Bot name must be at least 3 characters.",
  }),
  botDesc: z.string().min(3, {
    message: "Bot description must be at least 3 characters.",
  }),
});

export const CreateBotDialog = () => {
  const userProfile = useStoreAuth((state) => state.userProfile);

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
      const bot = await mediator.post("/bots", {
        owner: userProfile.email,
        ...values,
      });
      console.log(bot);
      form.reset();
    } catch (error: any) {
      console.log(error);
    }
  });

  return (
    <FormDialogBox
      title="Create Bot"
      triggerLabel="Create Bot"
      onSubmit={handleSubmit}
      onOpenChange={(open) => {
        if (!open) form.reset();
      }}
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
