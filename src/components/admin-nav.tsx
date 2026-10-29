"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, ClipboardCheck, FileSignature, FileText, Film, HelpCircle, LayoutDashboard, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/motoristas", label: "Motoristas", icon: Users },
  { href: "/admin/treinamentos", label: "Treinamentos", icon: BookOpen },
  { href: "/admin/videos", label: "Biblioteca de vídeos", icon: Film },
  { href: "/admin/questoes", label: "Banco de questões", icon: HelpCircle },
  { href: "/admin/provas", label: "Provas", icon: ClipboardCheck },
  { href: "/admin/termos", label: "Termos e documentos", icon: FileText },
  { href: "/admin/assinaturas", label: "Assinaturas", icon: FileSignature },
  { href: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
  { href: "/admin/configuracoes", label: "Configurações", icon: Settings },
  { href: "/admin/administradores", label: "Administradores", icon: ShieldCheck, superOnly: true },
];

export function AdminNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {items.filter((i) => !i.superOnly || role === "superadmin").map((i) => {
        const active = i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/");
        const Icon = i.icon;
        return (
          <Link key={i.href} href={i.href} onClick={onNavigate}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              active ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10 hover:text-white")}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />{i.label}
          </Link>
        );
      })}
    </nav>
  );
}
