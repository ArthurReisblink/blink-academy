"use client";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./ui/button";

export function Submit({ children, pendingText = "Aguarde…", ...p }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending || p.disabled} aria-busy={pending} {...p}>{pending ? pendingText : children}</Button>;
}
