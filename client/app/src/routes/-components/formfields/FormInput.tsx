import type { UseFormReturn, Path } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shadcn/ui/form";
import { Input as ShadcnInput } from "@/shadcn/ui/input";
import clsx from "clsx";

export function FormInput<T extends Record<string, any>>({
  form,
  label,
  name,
  placeHolder,
  type = "text",
  labelWidth = "w-32",
  inputClassName,
  gap = 12, // px
}: {
  form: UseFormReturn<T>;
  label: string;
  name: Path<T>;
  placeHolder?: string;
  type?: React.HTMLInputTypeAttribute;
  labelWidth?: string;
  inputClassName?: string;
  gap?: number; // pixels
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
              <ShadcnInput
                {...field}
                type={type}
                value={field.value ?? ""}
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
