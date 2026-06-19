import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

async function buildCatalogContext(): Promise<string> {
  const supa = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data } = await supa
    .from("parts")
    .select(
      `part_number, description, quantity, sis_url,
       groups:group_id ( name,
         systems:system_id ( name, subsystem,
           machines:machine_id ( model, serial_number )
         )
       ),
       aliases ( keyword )`,
    )
    .limit(50);
  if (!data?.length) return "Catálogo vazio.";
  return data
    .map((p: any) => {
      const sys = p.groups?.systems;
      const mac = sys?.machines;
      const aliases = (p.aliases ?? []).map((a: any) => a.keyword).join(", ");
      return `- Máquina ${mac?.model} (SN ${mac?.serial_number}) | Sistema: ${sys?.name} → ${sys?.subsystem} → Grupo: ${p.groups?.name} | PN: ${p.part_number} | Qtd: ${p.quantity} | Desc: ${p.description} | SIS: ${p.sis_url} | Sinônimos: ${aliases}`;
    })
    .join("\n");
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        const { messages }: { messages: UIMessage[] } = await request.json();

        const catalog = await buildCatalogContext();
        const gateway = createLovableAiGatewayProvider(key);

        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: `Você é o assistente do CAT Smart Parts, especialista em peças Caterpillar do SIS 2.0.
Responda SEMPRE em português, de forma direta, técnica e bem formatada (markdown).
Use exclusivamente o catálogo abaixo. Se a peça não estiver listada, diga claramente que ela ainda não está no catálogo e sugira cadastrar via extensão CAT Collector ou OCR.

Formato preferido da resposta:
**Máquina:** ...
**Sistema → Subsistema → Grupo:** ...
**Part Number:** \`PN\`
**Quantidade:** ...
**Descrição:** ...
**Link SIS:** ...

CATÁLOGO ATUAL:
${catalog}`,
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
