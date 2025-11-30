import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/shadcn/ui/form";
import { Textarea } from "@/shadcn/ui/textarea";
import { Button } from "@/shadcn/ui/button";
import { Switch } from "@/shadcn/ui/switch";

import { mediator } from "@/utils/mediator";
import { z } from "zod";
import { useAgentContext } from "../AgentsDetail";
import { toast } from "sonner";
import { FormInput } from "@/components/formfields/FormInput";
import { FormTextArea } from "@/components/formfields/FormTextArea";
import { FormSelect } from "@/components/formfields/FormSelect";

const botInfoSchema = z.object({
  botName: z.string().min(2, "Bot name must be at least 2 characters"),
  botDesc: z.string().optional(),
  baseModel: z.string().min(1, "Base model is required"),
  embedModel: z.string().optional(),
  toolModel: z.string().optional(),
  instruction: z.string().min(5, "Instruction must be meaningful"),
  kbsearchMethod: z.enum(["semantic", "keyword"]),
  publicAccess: z.boolean(),
  isActive: z.boolean(),
});

type BotInfoFormValues = z.infer<typeof botInfoSchema>;

export const TabBotForm = () => {
  const { botId } = useAgentContext();
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [botModels, setBotModels] = useState([]);

  const form = useForm<BotInfoFormValues>({
    resolver: zodResolver(botInfoSchema),
    defaultValues: {
      botName: "",
      botDesc: "",
      baseModel: "",
      instruction: "",
      kbsearchMethod: "semantic",
      publicAccess: false,
      isActive: true,
    },
  });

  useEffect(() => {
    mediator.get(`/bots/${botId}`).then((res) => {
      const bot = res.data.data;
      form.reset({
        botName: bot.botName,
        botDesc: bot.botDesc,
        baseModel: bot.baseModel?.name || "",
        instruction: bot.instruction || "",
        kbsearchMethod: bot.kbsearchMethod,
        publicAccess: bot.publicAccess,
        isActive: bot.isActive,
      });

      setLoading(false);
    });

    mediator
      .get(`/metadata/models`)
      .then((res) => {
        const result = res.data.data.map((item: any) => ({
          value: item.name,
          label: item.name,
        }));

        setBotModels(result);
      })
      .catch(() => console.log("error loading bot details"));
  }, [botId, form]);

  const onSubmit = async (values: BotInfoFormValues) => {
    try {
      await mediator.put(`/bots/${botId}`, values);
      toast("✅ Bot info updated successfully!");
    } catch (error) {
      toast("❌ Failed to update bot info.");
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-3 pb-3 text-sm"
      >
        {/* Submit */}
        <div className="flex justify-end">
          <Button type="submit" className="h-8 px-3 text-xs">
            Save Changes
          </Button>
        </div>

        {/* Bot Name */}
        <FormInput form={form} name="botName" label="Bot Name" />

        {/* Base Model */}
        {/* Kb Method */}
        <FormSelect
          form={form}
          name="baseModel"
          label="Base model"
          selectItems={botModels}
        />

        {/* Bot Description */}
        <FormTextArea form={form} name="botDesc" label="Description" />

        {/* System Instruction */}
        <FormField
          control={form.control}
          name="instruction"
          render={({ field }) => (
            <FormItem className="flex gap-3 items-start">
              <FormLabel className="text-xs w-32 text-right pt-1">
                Instruction
              </FormLabel>
              <div className="flex-1 space-y-1">
                <FormControl>
                  <Textarea
                    {...field}
                    rows={expanded ? 8 : 3}
                    className="text-xs px-2 resize-none h-auto min-h-[50px]"
                    onFocus={() => setExpanded(true)}
                    onBlur={() => setExpanded(false)}
                  />
                </FormControl>
                <FormMessage className="text-[10px]" />
              </div>
            </FormItem>
          )}
        />

        {/* Kb Method */}
        <FormSelect
          form={form}
          name="kbsearchMethod"
          label="Search Method"
          selectItems={[
            {
              value: "semantic",
              label: "Semantic",
            },
            {
              value: "keyword",
              label: "Keyword",
            },
          ]}
        />

        {/* Switches */}
        <div className="flex gap-10 mt-1 pl-36">
          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormLabel className="text-xs w-24">Active</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="publicAccess"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormLabel className="text-xs w-24">Public</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </form>
    </Form>
  );
};
