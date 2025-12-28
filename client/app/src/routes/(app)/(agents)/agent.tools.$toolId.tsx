import { FormInput } from "@/routes/-components/formfields/FormInput";
import { FormSelect } from "@/routes/-components/formfields/FormSelect";
import { FormTextArea } from "@/routes/-components/formfields/FormTextArea";
import { Button } from "@/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import { starGate } from "@/utils/starGate";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";
import { FormSwitch } from "@/routes/-components/formfields/FormSwitch";
import { Form } from "@/shadcn/ui/form";

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
      auth: { type: "none" },
      enabled: true,
      systemPrompt: "",
    },
  });

  const toolType = form.watch("type");
  const authType = form.watch("auth.type");

  useEffect(() => {
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-10">
        {/* Header */}
        <div className="sticky top-0 z-10 flex justify-between items-center bg-background border-b py-2">
          <h2 className="text-sm font-semibold">Tool Configuration</h2>
          <Button type="submit" size="sm">
            Save Tool
          </Button>
        </div>

        {/* General */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">General Information</CardTitle>
          </CardHeader>

          <CardContent className="grid grid-cols-2 gap-4">
            <FormInput form={form} name="name" label="Tool Name" />
            <FormSwitch form={form} name="enabled" label="Enabled" />
            <FormInput form={form} name="category" label="Category" />
            <FormSelect
              form={form}
              name="type"
              label="Tool Type"
              selectItems={[{ value: "http", label: "HTTP API" }]}
            />
            <FormTextArea form={form} name="description" label="Description" />
            <FormTextArea form={form} name="systemPrompt" label="tool prompt" />
          </CardContent>
        </Card>

        {/* HTTP Configuration */}
        {toolType === "http" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">HTTP Configuration</CardTitle>
            </CardHeader>

            <CardContent className="grid grid-cols-2 gap-4">
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
              <FormTextArea
                form={form}
                name="parameters"
                label="parameters (JSON)"
              />
            </CardContent>
          </Card>
        )}

        {/* Authentication */}
        {toolType === "http" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Authentication</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
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

              {authType === "basic" && (
                <>
                  <FormInput
                    form={form}
                    name="auth.username"
                    label="Username"
                  />
                  <FormInput
                    form={form}
                    name="auth.password"
                    label="Password"
                    type="password"
                  />
                </>
              )}

              {authType === "bearer" && (
                <FormInput
                  form={form}
                  name="auth.apiKey"
                  label="Bearer Token"
                />
              )}

              {authType === "apiKey" && (
                <>
                  <FormInput form={form} name="auth.apiKey" label="API Key" />
                  <FormInput
                    form={form}
                    name="auth.apiKeyName"
                    label="Key Name"
                  />
                  <FormSelect
                    form={form}
                    name="auth.apiKeyLocation"
                    label="Location"
                    selectItems={[
                      { value: "header", label: "Header" },
                      { value: "query", label: "Query Param" },
                    ]}
                  />
                </>
              )}
            </CardContent>
          </Card>
        )}
      </form>
    </Form>
  );
}

const toolSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(5),
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
