import { Form } from "@/shadcn/ui/form";
import { Button } from "@/shadcn/ui/button";
import { starGate } from "@/utils/starGate";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import z from "zod";
import { toast } from "sonner";
import { Pen } from "lucide-react";
import { FormDialogBox } from "@/routes/-components/dialog-box/FormDialogBox";
import { FormInput } from "@/routes/-components/formfields/FormInput";
import { FormTextArea } from "@/routes/-components/formfields/FormTextArea";
import { FormSelect } from "@/routes/-components/formfields/FormSelect";
import { FormSwitch } from "@/routes/-components/formfields/FormSwitch";

export type LlmModelRecord = {
  _id: string;
  name: string;
  provider: string;
  endpoint?: string;
  description?: string;
  tags?: string[];
  isActive: boolean;
  meta: {
    modelType: string;
    inputType: string;
    contextWindow: string;
    maxOutputTokens?: number;
    inputPrice?: number;
    outputPrice?: number;
    supportsTools?: boolean;
    supportsStreaming?: boolean;
  };
};

const formSchema = z.object({
  name: z
    .string({ error: "Model name is required." })
    .min(1, "Model name is required."),
  provider: z
    .string({ error: "Provider is required." })
    .min(1, "Provider is required."),
  endpoint: z.string().optional(),
  description: z.string().optional(),
  tagsInput: z.string().optional(),
  modelType: z.string().min(1, "Select a model type."),
  inputType: z.string().min(1, "Select an input type."),
  contextWindow: z
    .string({ error: "Context window is required." })
    .min(1, "Context window is required."),
  maxOutputTokens: z.string().optional(),
  inputPrice: z.string().optional(),
  outputPrice: z.string().optional(),
  supportsTools: z.boolean(),
  supportsStreaming: z.boolean(),
  isActive: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

const emptyValues: FormValues = {
  name: "",
  provider: "",
  endpoint: "",
  description: "",
  tagsInput: "",
  modelType: "",
  inputType: "",
  contextWindow: "",
  maxOutputTokens: "",
  inputPrice: "",
  outputPrice: "",
  supportsTools: false,
  supportsStreaming: false,
  isActive: true,
};

const toFormValues = (model: LlmModelRecord): FormValues => ({
  name: model.name,
  provider: model.provider,
  endpoint: model.endpoint ?? "",
  description: model.description ?? "",
  tagsInput: (model.tags ?? []).join(", "),
  modelType: model.meta?.modelType ?? "",
  inputType: model.meta?.inputType ?? "",
  contextWindow: model.meta?.contextWindow ?? "",
  maxOutputTokens:
    model.meta?.maxOutputTokens != null ? String(model.meta.maxOutputTokens) : "",
  inputPrice: model.meta?.inputPrice != null ? String(model.meta.inputPrice) : "",
  outputPrice: model.meta?.outputPrice != null ? String(model.meta.outputPrice) : "",
  supportsTools: model.meta?.supportsTools ?? false,
  supportsStreaming: model.meta?.supportsStreaming ?? false,
  isActive: model.isActive,
});

// Empty-string inputs mean "not set" here, not 0 — kept as a manual parse
// rather than z.coerce.number() so an empty optional field doesn't coerce to 0.
const toOptionalNumber = (value?: string): number | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toPayload = (values: FormValues) => ({
  name: values.name,
  provider: values.provider,
  endpoint: values.endpoint || undefined,
  description: values.description || undefined,
  tags: values.tagsInput
    ? values.tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [],
  isActive: values.isActive,
  meta: {
    modelType: values.modelType,
    inputType: values.inputType,
    contextWindow: values.contextWindow,
    maxOutputTokens: toOptionalNumber(values.maxOutputTokens),
    inputPrice: toOptionalNumber(values.inputPrice),
    outputPrice: toOptionalNumber(values.outputPrice),
    supportsTools: values.supportsTools,
    supportsStreaming: values.supportsStreaming,
  },
});

const MODEL_TYPE_OPTIONS = [
  { value: "chat", label: "Chat" },
  { value: "embedding", label: "Embedding" },
  { value: "code", label: "Code" },
];

const INPUT_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "text|image", label: "Text + Image" },
];

export const LlmModelFormDialog = ({
  refreshData,
  mode,
  model,
}: {
  refreshData: () => void;
  mode: "create" | "edit";
  model?: LlmModelRecord;
}) => {
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  });

  // Re-seed the form from the latest row data (or a blank slate for create)
  // every time the dialog opens, rather than only on first mount.
  useEffect(() => {
    if (open) {
      form.reset(mode === "edit" && model ? toFormValues(model) : emptyValues);
    }
  }, [open, mode, model, form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    const payload = toPayload(values);
    try {
      if (mode === "edit" && model) {
        await starGate.put(`/llm/${model._id}`, payload);
        toast("Model updated successfully.");
      } else {
        await starGate.post("/llm", payload);
        toast("Model registered successfully.");
      }
      setOpen(false);
      refreshData();
    } catch (error: unknown) {
      console.error(error);
      const serverMessage = isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : undefined;
      toast.error(
        serverMessage ?? `Failed to ${mode === "edit" ? "update" : "register"} model.`,
      );
    }
  });

  return (
    <FormDialogBox
      title={mode === "edit" ? "Edit LLM Model" : "Register LLM Model"}
      triggerLabel={mode === "edit" ? "Edit model" : "Register Model"}
      trigger={
        mode === "edit" ? (
          <Button size="icon" variant="ghost" className="cursor-pointer">
            <Pen className="h-4 w-4" />
          </Button>
        ) : undefined
      }
      maxWidth="sm:max-w-2xl"
      open={open}
      onOpenChange={setOpen}
      onSubmit={handleSubmit}
    >
      <Form {...form}>
        <form id="dialog-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormInput form={form} name="name" label="Name" gap={1} placeHolder="gpt-oss:120b-cloud" />
            <FormInput form={form} name="provider" label="Provider" gap={1} placeHolder="ollama" />
          </div>

          <FormInput form={form} name="endpoint" label="Endpoint" gap={1} placeHolder="optional — falls back to OLLAMA_BASE_URL" />

          <FormTextArea form={form} name="description" label="Description" gap={1} rows={2} />

          <FormInput
            form={form}
            name="tagsInput"
            label="Tags"
            gap={1}
            placeHolder="comma-separated, e.g. chat, cloud, tool-calling"
          />

          <div className="grid grid-cols-2 gap-4">
            <FormSelect form={form} name="modelType" label="Model type" gap={1} selectItems={MODEL_TYPE_OPTIONS} />
            <FormSelect form={form} name="inputType" label="Input type" gap={1} selectItems={INPUT_TYPE_OPTIONS} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormInput form={form} name="contextWindow" label="Context window" gap={1} placeHolder="128k" />
            <FormInput form={form} name="maxOutputTokens" label="Max output tokens" gap={1} type="number" placeHolder="optional" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormInput form={form} name="inputPrice" label="Input price" gap={1} type="number" placeHolder="optional, per 1M tokens" />
            <FormInput form={form} name="outputPrice" label="Output price" gap={1} type="number" placeHolder="optional, per 1M tokens" />
          </div>

          <div className="flex gap-8">
            <FormSwitch form={form} name="supportsTools" label="Tool calling" gap={8} labelWidth="w-28" />
            <FormSwitch form={form} name="supportsStreaming" label="Streaming" gap={8} labelWidth="w-28" />
            <FormSwitch form={form} name="isActive" label="Active" gap={8} labelWidth="w-20" />
          </div>
        </form>
      </Form>
    </FormDialogBox>
  );
};
