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

import { starGate } from "@/utils/starGate";
import { z } from "zod";
import { toast } from "sonner";
import { FormInput } from "@/routes/-components/formfields/FormInput";
import { FormTextArea } from "@/routes/-components/formfields/FormTextArea";
import { FormSelect } from "@/routes/-components/formfields/FormSelect";
import { Route } from "../agent-details.$botId";

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
  const { botId } = Route.useParams();
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
    starGate.get(`/bots/${botId}`).then((res) => {
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

    starGate
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
      await starGate.put(`/bots/${botId}`, values);
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
          <Button type="submit" className="h-8 px-3 text-xs cursor-pointer">
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
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="instruction"
            render={({ field }) => (
              <FormItem className="flex gap-4 items-start">
                <FormLabel className="w-32 pt-1 text-sm">Instruction</FormLabel>
                <div className="flex-1 max-w-[700px] space-y-1">
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={5}
                      className="text-xs px-2 resize-none w-full"
                    />
                  </FormControl>

                  <FormMessage className="text-xs" />
                </div>
              </FormItem>
            )}
          />
          <div className="space-y-3 pb-3 text-sm">
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
                    <FormLabel className="text-sm w-24">Active</FormLabel>
                    <FormControl>
                      <Switch
                        className="cursor-pointer"
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
                    <FormLabel className="text-sm w-24">Public</FormLabel>
                    <FormControl>
                      <Switch
                        className="cursor-pointer"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
};
