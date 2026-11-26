"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import { cn } from "./core";

function merge(...c: unknown[]) {
  return twMerge(clsx(c as string[]));
}

// ---------- Dialog ----------
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title }: { className?: string; children: React.ReactNode; title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-sm" />
      <DialogPrimitive.Content
        dir="rtl"
        className={merge(
          "fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2 rounded-2xl border border-line bg-white p-5 shadow-xl max-h-[85vh] overflow-y-auto",
          className
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <DialogPrimitive.Title className="text-base font-bold text-navy">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted hover:bg-lightblue" aria-label="close">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ---------- Tabs ----------
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={merge("flex flex-wrap gap-1 rounded-xl bg-lightblue p-1", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={merge(
        "rounded-lg px-3 py-1.5 text-sm font-semibold text-muted data-[state=active]:bg-white data-[state=active]:text-medblue-dark data-[state=active]:shadow-sm",
        className
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={merge("mt-4 focus-visible:outline-none", className)} {...props} />;
}

// ---------- Select (native محسّن — بساطة للمعمل) ----------
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  dir,
  id,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  disabled?: boolean;
  dir?: "rtl" | "ltr";
  id?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      dir={dir}
      disabled={disabled}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      className={cn(
        "h-10 w-full rounded-xl border border-input bg-white px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-medblue disabled:opacity-50",
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
