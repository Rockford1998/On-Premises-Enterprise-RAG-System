/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormInput } from "@/routes/-components/formfields/FormInput";
import { FormSelect } from "@/routes/-components/formfields/FormSelect";
import { FormTextArea } from "@/routes/-components/formfields/FormTextArea";
import { FormSwitch } from "@/routes/-components/formfields/FormSwitch";
import { Button } from "@/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import { Form } from "@/shadcn/ui/form";
import { starGate } from "@/utils/starGate";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/(app)/(agents)/agent/tools/$toolId")({
  component: RouteComponent,
});

/* ----------------------------- Schema ----------------------------- */

const toolSchema = z.object({
  botId: z.string().optional(),

  name: z.string().min(2),
  description: z.string().min(3),
  category: z.string().optional(),

  type: z.enum(["API", "database"]),

  endpoint: z.string().optional(),
  method: z.string().optional(),

  headers: z.any().optional(),

  auth: z.object({
    type: z.enum(["basic", "bearer", "apiKey", "none"]),
    username: z.string().optional(),
    password: z.string().optional(),
    apiKey: z.string().optional(),
    apiKeyLocation: z.enum(["header", "query"]).optional(),
    apiKeyName: z.string().optional(),
    fixedParams: z.any().optional(),
  }),

  enabled: z.boolean(),
  systemPrompt: z.string().optional(),

  /* frontend helper */
  parametersList: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["string", "number", "integer", "boolean"]),
        description: z.string().optional(),
        required: z.boolean().default(false),
      }),
    )
    .optional(),
});

type ToolFormValues = z.infer<typeof toolSchema>;

/* ----------------------------- Component ----------------------------- */

function RouteComponent() {
  const { toolId } = Route.useParams();
  const [loading, setLoading] = useState(true);

  const form = useForm<ToolFormValues>({
    resolver: zodResolver(toolSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      type: "API",
      endpoint: "",
      method: "GET",
      headers: {},
      auth: { type: "none" },
      enabled: true,
      systemPrompt: "",
      parametersList: [],
    },
  });

  const toolType = form.watch("type");
  const authType = form.watch("auth.type");

  /* ---------------------- Dynamic Parameters ---------------------- */

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "parametersList",
  });

  /* ---------------------- Load Tool ---------------------- */

  useEffect(() => {
    starGate.get(`/tools/${toolId}`).then((res) => {
      const data = res.data?.data;
      if (!data) return;

      /* convert parameters.properties -> parametersList */
      const parametersList: any[] = [];

      if (data.parameters?.properties) {
        Object.entries(data.parameters.properties).forEach(
          ([key, value]: any) => {
            parametersList.push({
              name: key,
              type: value.type || "string",
              description: value.description || "",
              required: data.parameters?.required?.includes(key) || false,
            });
          },
        );
      }

      form.reset({
        ...data,
        parametersList,
      });

      setLoading(false);
    });
  }, [toolId, form]);

  /* ---------------------- Submit ---------------------- */

  const onSubmit = async (values: ToolFormValues) => {
    try {
      const properties: any = {};
      const required: string[] = [];

      values.parametersList?.forEach((p) => {
        properties[p.name] = {
          type: p.type,
          description: p.description,
        };

        if (p.required) required.push(p.name);
      });

      const payload = {
        ...values,
        parameters: {
          type: "object",
          properties,
          required,
        },
      };

      delete (payload as any).parametersList;

      await starGate.put(`/tools/${toolId}`, payload);

      toast.success("Tool saved successfully");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save tool");
    }
  };

  if (loading) return <div>Loading...</div>;

  /* ----------------------------- UI ----------------------------- */

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
            <CardTitle className="text-sm">General</CardTitle>
          </CardHeader>

          <CardContent className="grid grid-cols-2 gap-4">
            <FormInput form={form} name="name" label="Tool Name" />
            <FormInput form={form} name="category" label="Category" />
            <FormSwitch form={form} name="enabled" label="Enabled" />

            <FormSelect
              form={form}
              name="type"
              label="Tool Type"
              selectItems={[
                { value: "API", label: "API" },
                { value: "database", label: "Database" },
              ]}
            />

            <FormTextArea form={form} name="description" label="Description" />

            <FormTextArea
              form={form}
              name="systemPrompt"
              label="System Prompt"
            />
          </CardContent>
        </Card>

        {/* API Config */}
        {toolType === "API" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">API Configuration</CardTitle>
            </CardHeader>

            <CardContent className="grid grid-cols-2 gap-4">
              <FormInput form={form} name="endpoint" label="Endpoint" />

              <FormSelect
                form={form}
                name="method"
                label="Method"
                selectItems={[
                  { value: "GET", label: "GET" },
                  { value: "POST", label: "POST" },
                  { value: "PUT", label: "PUT" },
                  { value: "DELETE", label: "DELETE" },
                ]}
              />
            </CardContent>
          </Card>
        )}

        {/* Authentication */}
        {toolType === "API" && (
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
                  { value: "basic", label: "Basic" },
                  { value: "bearer", label: "Bearer" },
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
                      { value: "query", label: "Query" },
                    ]}
                  />
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Parameters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Parameters</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-5 gap-3 items-end">
                <FormInput
                  form={form}
                  name={`parametersList.${index}.name`}
                  label="Name"
                />

                <FormSelect
                  form={form}
                  name={`parametersList.${index}.type`}
                  label="Type"
                  selectItems={[
                    { value: "string", label: "string" },
                    { value: "number", label: "number" },
                    { value: "integer", label: "integer" },
                    { value: "boolean", label: "boolean" },
                  ]}
                />

                <FormInput
                  form={form}
                  name={`parametersList.${index}.description`}
                  label="Description"
                />

                <FormSwitch
                  form={form}
                  name={`parametersList.${index}.required`}
                  label="Required"
                />

                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => remove(index)}
                >
                  Remove
                </Button>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                append({
                  name: "",
                  type: "string",
                  description: "",
                  required: false,
                })
              }
            >
              Add Parameter
            </Button>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
