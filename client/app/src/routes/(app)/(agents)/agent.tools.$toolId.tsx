/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormInput } from "@/routes/-components/formfields/FormInput";
import { FormSelect } from "@/routes/-components/formfields/FormSelect";
import { FormTextArea } from "@/routes/-components/formfields/FormTextArea";
import { FormSwitch } from "@/routes/-components/formfields/FormSwitch";
import { Button } from "@/shadcn/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shadcn/ui/card";
import { Form } from "@/shadcn/ui/form";
import { starGate } from "@/utils/starGate";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/(app)/(agents)/agent/tools/$toolId")({
  component: RouteComponent,
});

/* ----------------------------- Schema ----------------------------- */

const paramFieldSchema = z.object({
  name: z.string().min(1, "Required"),
  description: z.string().optional(),
  required: z.boolean(),
});

const toolSchema = z.object({
  botId: z.string().optional(),

  name: z.string().min(2),
  description: z.string().min(3),
  category: z.string().optional(),

  type: z.enum(["API", "DATABASE"]),

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

  /* execution-time argument sources — routed by tool.service.ts's
     routeToolArgs() by matching each name against the model's returned args */
  pathVariable: z
    .array(
      paramFieldSchema.extend({
        type: z.enum(["string", "number", "integer", "boolean"]),
      }),
    )
    .optional(),
  queryParam: z
    .array(
      paramFieldSchema.extend({
        type: z.enum(["string", "number", "integer", "boolean", "array"]),
        defaultValue: z.string().optional(),
      }),
    )
    .optional(),
  requestBodyFields: z
    .array(
      paramFieldSchema.extend({
        type: z.enum(["string", "number", "integer", "boolean"]),
      }),
    )
    .optional(),
  requestBodyContentType: z
    .enum([
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ])
    .optional(),
});

type ToolFormValues = z.infer<typeof toolSchema>;

const emptyParamField = { name: "", description: "", required: false };

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
      pathVariable: [],
      queryParam: [],
      requestBodyFields: [],
      requestBodyContentType: "application/json",
    },
  });

  const toolType = form.watch("type");
  const authType = form.watch("auth.type");
  const method = form.watch("method");
  const hasRequestBody = method !== "GET" && method !== "DELETE";

  /* ---------------------- Dynamic field arrays ---------------------- */

  const pathVariables = useFieldArray({ control: form.control, name: "pathVariable" });
  const queryParams = useFieldArray({ control: form.control, name: "queryParam" });
  const bodyFields = useFieldArray({ control: form.control, name: "requestBodyFields" });

  /* ---------------------- Load Tool ---------------------- */

  useEffect(() => {
    starGate.get(`/tools/${toolId}`).then((res) => {
      const data = res.data?.data;
      if (!data) return;

      const requestBodyFields: any[] = [];
      const bodySchema = data.requestBody?.schema;
      if (bodySchema?.properties) {
        Object.entries(bodySchema.properties).forEach(([key, value]: any) => {
          requestBodyFields.push({
            name: key,
            type: value.type || "string",
            description: value.description || "",
            required: bodySchema.required?.includes(key) || false,
          });
        });
      }

      form.reset({
        ...data,
        pathVariable: data.pathVariable || [],
        queryParam: data.queryParam || [],
        requestBodyFields,
        requestBodyContentType: data.requestBody?.contentType || "application/json",
      });

      setLoading(false);
    });
  }, [toolId, form]);

  /* ---------------------- Submit ---------------------- */

  const onSubmit = async (values: ToolFormValues) => {
    try {
      // `parameters.properties` is what tool-detection sends the LLM — derive
      // it from the three typed sections so there's one source of truth
      // instead of a separately hand-maintained list.
      const properties: Record<string, any> = {};
      const required: string[] = [];
      const addToParameters = (
        fields: { name: string; type?: string; description?: string; required?: boolean }[] = [],
      ) => {
        fields.forEach((f) => {
          if (!f.name) return;
          properties[f.name] = { type: f.type || "string", description: f.description };
          if (f.required) required.push(f.name);
        });
      };
      addToParameters(values.pathVariable);
      addToParameters(values.queryParam);
      addToParameters(values.requestBodyFields);

      const bodyProperties: Record<string, any> = {};
      const bodyRequired: string[] = [];
      (values.requestBodyFields || []).forEach((f) => {
        if (!f.name) return;
        bodyProperties[f.name] = { type: f.type, description: f.description };
        if (f.required) bodyRequired.push(f.name);
      });

      const { requestBodyFields, requestBodyContentType, ...rest } = values;

      const payload = {
        ...rest,
        parameters: { type: "object", properties, required },
        requestBody: hasRequestBody
          ? {
              contentType: requestBodyContentType,
              schema:
                Object.keys(bodyProperties).length > 0
                  ? { type: "object", properties: bodyProperties, required: bodyRequired }
                  : undefined,
            }
          : undefined,
      };

      await starGate.put(`/tools/${toolId}`, payload);

      toast.success("Tool saved successfully");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save tool");
    }
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;

  /* ----------------------------- UI ----------------------------- */

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-10">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background py-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h2 className="font-serif text-base font-semibold">Tool Configuration</h2>
          </div>
          <Button type="submit" size="sm" className="cursor-pointer">
            Save Tool
          </Button>
        </div>

        {/* General */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">General</CardTitle>
            <CardDescription>Identity and behavior shown to the model.</CardDescription>
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
                { value: "DATABASE", label: "Database" },
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

        {toolType === "DATABASE" && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Database tools aren't executable yet — this configuration will be
              saved, but chat requests can't run it until database execution
              support is added.
            </CardContent>
          </Card>
        )}

        {/* API Config */}
        {toolType === "API" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">API Configuration</CardTitle>
              <CardDescription>
                Use <code className="rounded bg-muted px-1 py-0.5 text-xs">:name</code> or{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{name}"}</code> in
                the endpoint for a path variable declared below.
              </CardDescription>
            </CardHeader>

            <CardContent className="grid grid-cols-2 gap-4">
              <FormInput
                form={form}
                name="endpoint"
                label="Endpoint"
                placeHolder="https://api.example.com/users/:userId"
              />

              <FormSelect
                form={form}
                name="method"
                label="Method"
                selectItems={[
                  { value: "GET", label: "GET" },
                  { value: "POST", label: "POST" },
                  { value: "PUT", label: "PUT" },
                  { value: "PATCH", label: "PATCH" },
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

        {/* Path Variables */}
        {toolType === "API" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Path Variables</CardTitle>
              <CardDescription>
                Substituted into the endpoint URL. The model fills these in from the user's message.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              {pathVariables.fields.length === 0 && (
                <p className="text-xs text-muted-foreground">No path variables configured.</p>
              )}
              {pathVariables.fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-3 items-end">
                  <FormInput
                    form={form}
                    name={`pathVariable.${index}.name`}
                    label="Name"
                    labelWidth="w-full"
                    gap={4}
                  />
                  <FormSelect
                    form={form}
                    name={`pathVariable.${index}.type`}
                    label="Type"
                    labelWidth="w-full"
                    gap={4}
                    selectItems={[
                      { value: "string", label: "string" },
                      { value: "number", label: "number" },
                      { value: "integer", label: "integer" },
                      { value: "boolean", label: "boolean" },
                    ]}
                  />
                  <FormInput
                    form={form}
                    name={`pathVariable.${index}.description`}
                    label="Description"
                    labelWidth="w-full"
                    gap={4}
                  />
                  <FormSwitch
                    form={form}
                    name={`pathVariable.${index}.required`}
                    label="Required"
                    labelWidth="w-auto"
                    gap={6}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 cursor-pointer text-destructive"
                    onClick={() => pathVariables.remove(index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() =>
                  pathVariables.append({ ...emptyParamField, type: "string", required: true } as any)
                }
              >
                <Plus className="size-3.5" /> Add Path Variable
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Query Parameters */}
        {toolType === "API" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Query Parameters</CardTitle>
              <CardDescription>
                Appended to the request as <code className="rounded bg-muted px-1 py-0.5 text-xs">?name=value</code>.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              {queryParams.fields.length === 0 && (
                <p className="text-xs text-muted-foreground">No query parameters configured.</p>
              )}
              {queryParams.fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-[1fr_1fr_1fr_1fr_auto_auto] gap-3 items-end"
                >
                  <FormInput
                    form={form}
                    name={`queryParam.${index}.name`}
                    label="Name"
                    labelWidth="w-full"
                    gap={4}
                  />
                  <FormSelect
                    form={form}
                    name={`queryParam.${index}.type`}
                    label="Type"
                    labelWidth="w-full"
                    gap={4}
                    selectItems={[
                      { value: "string", label: "string" },
                      { value: "number", label: "number" },
                      { value: "integer", label: "integer" },
                      { value: "boolean", label: "boolean" },
                      { value: "array", label: "array" },
                    ]}
                  />
                  <FormInput
                    form={form}
                    name={`queryParam.${index}.description`}
                    label="Description"
                    labelWidth="w-full"
                    gap={4}
                  />
                  <FormInput
                    form={form}
                    name={`queryParam.${index}.defaultValue`}
                    label="Default"
                    labelWidth="w-full"
                    gap={4}
                  />
                  <FormSwitch
                    form={form}
                    name={`queryParam.${index}.required`}
                    label="Required"
                    labelWidth="w-auto"
                    gap={6}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 cursor-pointer text-destructive"
                    onClick={() => queryParams.remove(index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => queryParams.append({ ...emptyParamField, type: "string" } as any)}
              >
                <Plus className="size-3.5" /> Add Query Parameter
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Request Body */}
        {toolType === "API" && hasRequestBody && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Request Body</CardTitle>
              <CardDescription>Fields sent in the request body for {method} requests.</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <FormSelect
                form={form}
                name="requestBodyContentType"
                label="Content Type"
                selectItems={[
                  { value: "application/json", label: "application/json" },
                  { value: "application/x-www-form-urlencoded", label: "x-www-form-urlencoded" },
                  { value: "multipart/form-data", label: "multipart/form-data" },
                ]}
              />

              {bodyFields.fields.length === 0 && (
                <p className="text-xs text-muted-foreground">No body fields configured.</p>
              )}
              {bodyFields.fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-3 items-end">
                  <FormInput
                    form={form}
                    name={`requestBodyFields.${index}.name`}
                    label="Name"
                    labelWidth="w-full"
                    gap={4}
                  />
                  <FormSelect
                    form={form}
                    name={`requestBodyFields.${index}.type`}
                    label="Type"
                    labelWidth="w-full"
                    gap={4}
                    selectItems={[
                      { value: "string", label: "string" },
                      { value: "number", label: "number" },
                      { value: "integer", label: "integer" },
                      { value: "boolean", label: "boolean" },
                    ]}
                  />
                  <FormInput
                    form={form}
                    name={`requestBodyFields.${index}.description`}
                    label="Description"
                    labelWidth="w-full"
                    gap={4}
                  />
                  <FormSwitch
                    form={form}
                    name={`requestBodyFields.${index}.required`}
                    label="Required"
                    labelWidth="w-auto"
                    gap={6}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 cursor-pointer text-destructive"
                    onClick={() => bodyFields.remove(index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => bodyFields.append({ ...emptyParamField, type: "string" } as any)}
              >
                <Plus className="size-3.5" /> Add Body Field
              </Button>
            </CardContent>
          </Card>
        )}
      </form>
    </Form>
  );
}
