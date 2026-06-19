import { Link } from "@tanstack/react-router";
import { Cog, MessageSquare, ScanLine, Star, History, Puzzle, Database, Inbox, FileSpreadsheet } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="size-9 rounded-md bg-primary flex items-center justify-center shadow-[0_0_30px_-5px_var(--cat-yellow)]">
              <Cog className="size-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="font-bold tracking-tight text-foreground">CAT Smart Parts</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                SIS 2.0 Assistant
              </div>
            </div>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <NavLink to="/" icon={<Cog className="size-4" />}>Buscar</NavLink>
            <NavLink to="/base" icon={<Database className="size-4" />}>Base</NavLink>
            <NavLink to="/captures" icon={<Inbox className="size-4" />}>Revisão</NavLink>
            <NavLink to="/import" icon={<FileSpreadsheet className="size-4" />}>Importar</NavLink>
            <NavLink to="/chat" icon={<MessageSquare className="size-4" />}>Chat IA</NavLink>
            <NavLink to="/ocr" icon={<ScanLine className="size-4" />}>OCR</NavLink>
            <NavLink to="/history" icon={<History className="size-4" />}>Histórico</NavLink>
            <NavLink to="/favorites" icon={<Star className="size-4" />}>Favoritos</NavLink>
            <NavLink to="/extension" icon={<Puzzle className="size-4" />}>Extensão</NavLink>
          </nav>
        </div>
        <div className="cat-stripe h-1" />
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border py-4 text-xs text-muted-foreground text-center">
        CAT Smart Parts · Assistente independente para o SIS 2.0 da Caterpillar
      </footer>
    </div>
  );
}

function NavLink({
  to,
  children,
  icon,
}: {
  to: string;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition flex items-center gap-1.5"
      activeProps={{ className: "px-3 py-1.5 rounded-md text-primary bg-accent flex items-center gap-1.5" }}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}
