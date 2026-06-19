import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat IA — CAT Smart Parts" },
      { name: "description", content: "Converse com a IA sobre peças Caterpillar do SIS 2.0." },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, status]);

  const busy = status === "submitted" || status === "streaming";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text || busy) return;
    inputRef.current!.value = "";
    await sendMessage({ text });
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 flex flex-col h-[calc(100vh-9rem)]">
        <header className="mb-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Assistente CAT — Gemini
          </div>
          <h1 className="mt-3 text-2xl font-bold">Pergunte sobre uma peça</h1>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1">
          {messages.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Exemplo: <em>"Qual o retentor do virabrequim da 345 GC?"</em>
            </div>
          )}
          {messages.map((m) => {
            const text = m.parts
              .map((p) => (p.type === "text" ? p.text : ""))
              .join("");
            const isUser = m.role === "user";
            return (
              <div
                key={m.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border border-border"
                  }`}
                >
                  {isUser ? (
                    <div className="whitespace-pre-wrap">{text}</div>
                  ) : (
                    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-strong:text-primary">
                      <ReactMarkdown>{text || "..."}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Consultando catálogo...
            </div>
          )}
        </div>

        <form
          onSubmit={submit}
          className="mt-4 flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-primary"
        >
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Digite sua pergunta..."
            className="flex-1 bg-transparent outline-none resize-none px-2 py-2 text-sm placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:brightness-110 disabled:opacity-60"
          >
            <Send className="size-4" /> Enviar
          </button>
        </form>
      </div>
    </AppShell>
  );
}
