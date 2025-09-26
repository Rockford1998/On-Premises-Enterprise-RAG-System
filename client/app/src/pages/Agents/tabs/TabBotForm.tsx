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
import { Input } from "@/shadcn/ui/input";
import { Textarea } from "@/shadcn/ui/textarea";
import { Button } from "@/shadcn/ui/button";
import { Switch } from "@/shadcn/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/shadcn/ui/select";
import { mediator } from "@/utils/mediator";

import { z } from "zod";
import { useAgentContext } from "../AgentsDetail";
import { toast } from "sonner";

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
  const [instructionExpanded, setInstructionExpanded] = useState(false);
  const form = useForm<BotInfoFormValues>({
    resolver: zodResolver(botInfoSchema),
    defaultValues: {
      botName: "",
      botDesc: "",
      baseModel: "",
      embedModel: "",
      toolModel: "",
      instruction: "",
      kbsearchMethod: "semantic",
      publicAccess: false,
      isActive: true,
    },
  });

  useEffect(() => {
    mediator
      .get(`/bots/${botId}`)
      .then((res) => {
        form.reset(res.data.data); // Prefill with API data
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [botId, form]);

  const onSubmit = async (values: BotInfoFormValues) => {
    try {
      await mediator.put(`/bots/${botId}`, values);
      toast("✅ Bot info updated successfully!");
    } catch (error) {
      console.error("Failed to update bot info:", error);
      toast("❌ Failed to update bot info.");
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="h-100">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl mx-auto p-4"
        >
          {/* Bot Name */}
          <FormField
            control={form.control}
            name="botName"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel className="text-sm">Bot Name:</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Bot name"
                    {...field}
                    className="text-sm py-1"
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          {/* Base Model */}
          <FormField
            control={form.control}
            name="baseModel"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel className="text-sm">Base Model:</FormLabel>
                <FormControl>
                  <Input
                    placeholder="mistral:latest"
                    {...field}
                    className="text-sm py-1"
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          {/* Bot Description */}
          <FormField
            control={form.control}
            name="botDesc"
            render={({ field }) => (
              <FormItem className="flex flex-col col-span-full">
                <FormLabel className="text-sm">Bot Description:</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Description"
                    {...field}
                    className="text-sm py-1 min-h-[60px]"
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          {/* Knowledge Search Method */}
          <FormField
            control={form.control}
            name="kbsearchMethod"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel className="text-sm">Search Method:</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="semantic">Semantic</SelectItem>
                      <SelectItem value="keyword">Keyword</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          {/* Instruction */}
          <FormField
            control={form.control}
            name="instruction"
            render={({ field }) => (
              <FormItem className="flex flex-col col-span-full">
                <FormLabel className="text-sm">System Instruction:</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    readOnly={!instructionExpanded}
                    rows={instructionExpanded ? 8 : 4}
                    className={`text-sm py-1 transition-all resize-none ${
                      !instructionExpanded ? " cursor-pointer" : ""
                    }`}
                    onClick={() => {
                      if (!instructionExpanded) setInstructionExpanded(true);
                    }}
                    onBlur={() => setInstructionExpanded(false)}
                    autoFocus={instructionExpanded}
                    placeholder="Click to add instruction"
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          {/* Toggles */}
          <div className="col-span-full flex gap-4">
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 flex-1">
                  <FormLabel className="text-sm">Active:</FormLabel>
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
                <FormItem className="flex items-center gap-2 flex-1">
                  <FormLabel className="text-sm">Public Access</FormLabel>
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

          {/* Submit Button */}
          <div className="col-span-full flex justify-end">
            <Button
              type="submit"
              className="w-full md:w-auto py-1 text-sm cursor-pointer"
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
