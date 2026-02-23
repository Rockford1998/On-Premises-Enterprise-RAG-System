import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shadcn/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/ui/select";
import clsx from "clsx";

import type { Path, UseFormReturn } from "react-hook-form";

export const FormSelect = <T extends Record<string, any>>({
  form,
  label,
  name,
  selectItems,
  labelWidth = "w-32",
  gap = 12,
  placeholder,
}: {
  form: UseFormReturn<T>;
  label: string;
  name: Path<T>;
  selectItems: { value: string; label: string | number }[];
  labelWidth?: string;
  placeholder?: string;
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

          <div className="flex-1 space-y-1">
            <FormControl>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-8 text-sm px-2 w-full">
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {selectItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage className="text-xs" />
          </div>
        </FormItem>
      )}
    />
  );
};
