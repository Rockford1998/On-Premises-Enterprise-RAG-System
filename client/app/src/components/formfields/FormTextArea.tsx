import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shadcn/ui/form";
import { Textarea } from "@/shadcn/ui/textarea";
import clsx from "clsx";
import type { Path, UseFormReturn } from "react-hook-form";

export function FormTextArea<T extends Record<string, any>>({
  form,
  label,
  name,
  placeHolder,
  labelWidth = "w-32",
  inputClassName,
  gap = 12,
}: {
  form: UseFormReturn<T>;
  label: string;
  name: Path<T>;
  labelWidth?: string;
  placeHolder?: string;
  inputClassName?: string;
  gap?: number;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start" style={{ gap }}>
          <FormLabel className={clsx("text-sm pt-1", labelWidth)}>
            {label}
          </FormLabel>

          <div className="flex-1 space-y-1">
            <FormControl>
              <Textarea
                {...field}
                value={String(field.value ?? "")}
                placeholder={placeHolder}
                className={clsx("h-8 text-xs px-2", inputClassName)}
              />
            </FormControl>
            <FormMessage className="text-xs" />
          </div>
        </FormItem>
      )}
    />
  );
}
