import { FormInput } from "@/routes/-components/formfields/FormInput";
import { FormSelect } from "@/routes/-components/formfields/FormSelect";
import { FormTextArea } from "@/routes/-components/formfields/FormTextArea";
import { Button } from "@/shadcn/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/shadcn/ui/form";
import { starGate } from "@/utils/starGate";
import { zodResolver } from "@hookform/resolvers/zod";
import { Switch } from "@radix-ui/react-switch";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";

export const Route = createFileRoute("/(app)/(agents)/agent/tools/$toolId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { toolId } = Route.useParams();
  const [loading, setLoading] = useState(true);

  const form = useForm<ToolFormValues>({
    resolver: zodResolver(toolSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      type: "http",
      parameters: {},
      endpoint: "",
      method: "GET",
      headers: {},
      auth: {
        type: "none",
      },
      enabled: true,
      systemPrompt: "",
    },
  });
  const toolType = form.watch("type");
  const authType = form.watch("auth.type");

  useEffect(() => {
    // If editing existing tool
    starGate.get(`/tools/${toolId}`).then((res) => {
      if (!res.data?.data) return;
      form.reset(res.data.data);
      setLoading(false);
    });
  }, [toolId, form]);

  const onSubmit = async (values: ToolFormValues) => {
    try {
      await starGate.put(`/tools/${toolId}`, values);
      toast("✅ Tool saved successfully");
    } catch {
      toast("❌ Failed to save tool");
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
            Save Tool
          </Button>
        </div>

        {/* Tool Name */}
        <FormInput form={form} name="name" label="Tool Name" />

        {/* Description */}
        <FormTextArea form={form} name="description" label="Description" />

        {/* Category */}
        <FormInput form={form} name="category" label="Category" />

        {/* Tool Type */}
        <FormSelect
          form={form}
          name="type"
          label="Tool Type"
          selectItems={[
            { value: "http", label: "HTTP API" },
            { value: "database", label: "Database" },
            { value: "local-function", label: "Local Function" },
          ]}
        />

        {/* HTTP Fields */}
        {toolType === "http" && (
          <>
            <FormInput form={form} name="endpoint" label="Endpoint URL" />

            <FormSelect
              form={form}
              name="method"
              label="HTTP Method"
              selectItems={[
                { value: "GET", label: "GET" },
                { value: "POST", label: "POST" },
                { value: "PUT", label: "PUT" },
                { value: "DELETE", label: "DELETE" },
              ]}
            />

            <FormTextArea form={form} name="headers" label="Headers (JSON)" />
          </>
        )}

        {/* Parameters */}
        <FormTextArea
          form={form}
          name="parameters"
          label="Parameters (JSON Schema)"
        />

        {/* Auth Type */}
        {toolType === "http" && (
          <FormSelect
            form={form}
            name="auth.type"
            label="Auth Type"
            selectItems={[
              { value: "none", label: "None" },
              { value: "basic", label: "Basic Auth" },
              { value: "bearer", label: "Bearer Token" },
              { value: "apiKey", label: "API Key" },
            ]}
          />
        )}

        {/* Auth Fields */}
        {authType === "basic" && (
          <>
            <FormInput form={form} name="auth.username" label="Username" />
            <FormInput
              form={form}
              name="auth.password"
              label="Password"
              type="password"
            />
          </>
        )}

        {authType === "bearer" && (
          <FormInput form={form} name="auth.apiKey" label="Bearer Token" />
        )}

        {authType === "apiKey" && (
          <>
            <FormInput form={form} name="auth.apiKey" label="API Key" />
            <FormInput
              form={form}
              name="auth.apiKeyName"
              label="API Key Name"
            />
            <FormSelect
              form={form}
              name="auth.apiKeyLocation"
              label="API Key Location"
              selectItems={[
                { value: "header", label: "Header" },
                { value: "query", label: "Query Param" },
              ]}
            />
          </>
        )}

        {/* System Prompt */}
        <FormTextArea
          form={form}
          name="systemPrompt"
          label="System Prompt (optional)"
        />

        {/* Enabled Switch */}
        <div className="flex gap-10 mt-2 pl-36">
          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormLabel className="text-xs w-24">Enabled</FormLabel>
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
}

const toolSchema = z.object({
  name: z.string().min(2, "Tool name is required"),
  description: z.string().min(5, "Description is required"),
  category: z.string().optional(),

  type: z.enum(["http", "database", "local-function"]),

  parameters: z.record(z.string(), z.any()),

  endpoint: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.any()).optional(),

  auth: z.object({
    type: z.enum(["basic", "bearer", "apiKey", "none"]),
    username: z.string().optional(),
    password: z.string().optional(),
    apiKey: z.string().optional(),
    apiKeyLocation: z.enum(["header", "query"]).optional(),
    apiKeyName: z.string().optional(),
  }),

  enabled: z.boolean(),
  systemPrompt: z.string().optional(),
});

type ToolFormValues = z.infer<typeof toolSchema>;
