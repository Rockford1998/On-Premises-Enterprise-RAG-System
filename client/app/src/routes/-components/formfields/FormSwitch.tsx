import { FormControl, FormField, FormItem, FormLabel } from "@/shadcn/ui/form";
import { Switch } from "@/shadcn/ui/switch";
import clsx from "clsx";
import type { Path, UseFormReturn } from "react-hook-form";

export const FormSwitch = <T extends Record<string, any>>({
  form,
  label,
  name,
  labelWidth = "w-32",
  gap = 12,
}: {
  form: UseFormReturn<T>;
  label: string;
  name: Path<T>;
  labelWidth?: string;
  gap?: number;
}) => {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start" style={{ gap }}>
          <FormLabel className={clsx("text-sm pt-1", labelWidth)}>
            {label}
          </FormLabel>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
};
