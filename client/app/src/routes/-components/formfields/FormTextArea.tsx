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
  rows = 5, // Added rows prop with default value
}: {
  form: UseFormReturn<T>;
  label: string;
  name: Path<T>;
  labelWidth?: string;
  placeHolder?: string;
  inputClassName?: string;
  gap?: number;
  rows?: number; // Added rows prop
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
                rows={rows} // Use the rows prop
                placeholder={placeHolder}
                className={clsx(
                  "px-2 text-xs", // Removed h-12 from here
                  "resize-none overflow-y-auto", // Added overflow control
                  inputClassName
                )}
              />
            </FormControl>
            <FormMessage className="text-xs" />
          </div>
        </FormItem>
      )}
    />
  );
}
