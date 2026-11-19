// Turn a `claude -p --output-format stream-json --verbose` log into a readable
// Markdown transcript of the agent <-> Kane loop (assistant text, tool calls,
// Stop-hook feedback, final result).
//   node scripts/loop-transcript.mjs session.jsonl > transcript.md
import fs from "node:fs";

const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
const out = [];
for (const line of lines) {
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.type === "assistant") {
    for (const c of e.message.content) {
      if (c.type === "text" && c.text.trim()) out.push(`**Claude:** ${c.text.trim()}\n`);
      if (c.type === "tool_use") {
        const what = c.input.command ? "`" + c.input.command + "`" : (c.input.file_path ?? "");
        out.push(`> 🔧 \`${c.name}\` ${what}\n`);
      }
    }
  } else if (e.type === "user") {
    const content = e.message.content;
    const injected = typeof content === "string"
      ? content
      : content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (/Stop hook feedback/.test(injected)) out.push("**🛑 Stop hook (Kane CLI):**\n\n```\n" + injected.trim() + "\n```\n");
  } else if (e.type === "system" && e.subtype === "hook_response") {
    const msg = (e.output ?? e.stdout ?? "").match(/\{"systemMessage":"([^"]+)"/);
    if (msg) out.push(`**✅ Stop hook:** ${msg[1]}\n`);
  } else if (e.type === "result") {
    const cost = typeof e.total_cost_usd === "number" ? ` · $${e.total_cost_usd.toFixed(2)}` : "";
    out.push(`---\n*Session ended: ${e.subtype} · ${e.num_turns} turns · ${Math.round((e.duration_ms ?? 0) / 1000)}s${cost}*`);
  }
}
console.log(out.join("\n"));
