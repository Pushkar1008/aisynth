import { useEffect, useRef, useState } from "react";
import { T, btnBase, inputBase, labelStyle, MONO, PALETTE } from "../theme";
import { Banner, CopyBtn, Empty, Icon, Icons, Markdown, SmallBtn } from "../components/common";
import { chatOnce, chatStream, extractJson, modelOptions } from "../lib/ollama";
import { formatSandboxResult, runInSandbox } from "../lib/sandbox";
import { parseToolCall, runTool } from "../lib/tools";
import { usePersistentState } from "../lib/storage";
import { downloadText } from "../lib/download";
import { clip, uid } from "../lib/util";

// ═══════════════════════════════════════════════════════════════
// What-if analysis: a swarm of agents designed by the model itself.
//
//  1. PLAN     the model designs scenarios, agents and (optionally) tools
//  2. CODE     generated JavaScript tools are tested in a sandbox and repaired
//  3. REVIEW   you approve the plan (can be turned off in Settings)
//  4. DISCUSS  agents take turns on a shared transcript, calling tools
//  5. REPORT   a synthesizer writes the final comparison
// ═══════════════════════════════════════════════════════════════

const BUILTIN_TOOLS = [
  { name: "web_search", description: "Look up facts (Wikipedia or SearXNG)", params: ["query"], custom: false },
  { name: "execute_code", description: "Run JavaScript for calculations or simulations; use console.log and return", params: ["code"], custom: false },
];
const RESERVED = new Set(["web_search", "execute_code", "read_file", "write_file", "list_files", "summarize", "analyze_data"]);

const EXAMPLES = [
  "What if we raise the price of our SaaS plan by 15%? Current: 2,000 customers at $40/month, 3% monthly churn.",
  "Should a 10-person startup move from a monolith to microservices this year?",
  "What happens to a city's commute times if remote work rises from 20% to 40% of jobs?",
];

const DEFAULT_TEAM = [
  { name: "Analyst", role: "Lead analyst", instructions: "Frame the problem, state the assumptions and estimate impacts for each scenario." },
  { name: "Skeptic", role: "Devil's advocate", instructions: "Challenge assumptions, find failure modes and name what could go wrong." },
  { name: "Quant", role: "Quantitative modeler", instructions: "Use numbers. Build quick models, ideally with the execute_code tool, to compare scenarios." },
  { name: "Strategist", role: "Strategist", instructions: "Weigh the trade-offs and propose a concrete recommendation with next steps." },
  { name: "Operator", role: "Implementation lead", instructions: "Judge feasibility, cost and the practical steps of each scenario." },
  { name: "Customer", role: "Voice of the affected people", instructions: "Represent the people affected and explain how they would react." },
];

const cleanName = (s, fallback) => String(s || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 20) || fallback;

// Models often return a function declaration instead of a body.
function wrapIfFunction(code) {
  const fn = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(code);
  if (fn) return `${code}\nreturn ${fn[1]}(args);`;
  const arrow = /^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/.exec(code);
  if (arrow) return `${code}\nreturn ${arrow[1]}(args);`;
  return code;
}

function normalizePlan(raw, maxAgents) {
  const plan = { summary: "", scenarios: [], agents: [], tools: [] };
  if (raw && typeof raw === "object") {
    plan.summary = String(raw.summary || raw.approach || "").slice(0, 400);
    (Array.isArray(raw.scenarios) ? raw.scenarios : []).slice(0, 4).forEach((s, i) => {
      const name = typeof s === "string" ? s : s?.name;
      if (name) plan.scenarios.push({ name: String(name).slice(0, 60), description: String(s?.description || "").slice(0, 300) || (i === 0 ? "Current course of action" : "") });
    });
    const used = new Set();
    (Array.isArray(raw.agents) ? raw.agents : []).slice(0, maxAgents).forEach((a, i) => {
      if (!a || typeof a !== "object") return;
      let name = cleanName(a.name, `Agent${i + 1}`);
      while (used.has(name.toLowerCase())) name += "2";
      used.add(name.toLowerCase());
      plan.agents.push({
        name,
        role: String(a.role || "Analyst").slice(0, 80),
        instructions: String(a.instructions || a.goal || "Contribute your perspective.").slice(0, 400),
        tools: Array.isArray(a.tools) ? a.tools.map(String).slice(0, 6) : [],
      });
    });
    const usedTools = new Set();
    (Array.isArray(raw.tools) ? raw.tools : []).slice(0, 3).forEach((t, i) => {
      if (!t || typeof t.code !== "string" || !t.code.trim()) return;
      const name = cleanName(t.name, `tool${i + 1}`).toLowerCase();
      if (RESERVED.has(name) || usedTools.has(name)) return;
      usedTools.add(name);
      const example = t.example_args && typeof t.example_args === "object" && !Array.isArray(t.example_args) ? t.example_args : {};
      plan.tools.push({
        name,
        description: String(t.description || "").slice(0, 200),
        params: Array.isArray(t.params) ? t.params.map(String).slice(0, 6) : Object.keys(example),
        example_args: example,
        code: wrapIfFunction(t.code.slice(0, 4000)),
        custom: true,
        status: "pending",
      });
    });
  }
  if (!plan.scenarios.length) plan.scenarios = [{ name: "Baseline", description: "Current course of action" }, { name: "Alternative", description: "The main alternative to compare against" }];
  if (plan.agents.length < 2) plan.agents = DEFAULT_TEAM.slice(0, Math.max(3, Math.min(maxAgents, 4))).map((a) => ({ ...a, tools: [] }));
  return plan;
}

// ─── swarm graph ───────────────────────────────────────────────
function SwarmGraph({ agents, active, links }) {
  const W = 640, H = 250, cx = W / 2, cy = H / 2, rx = 245, ry = 88;
  const pos = {};
  agents.forEach((a, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / agents.length;
    pos[a.name] = { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang), color: PALETTE[i % PALETTE.length] };
  });
  const maxCount = Math.max(1, ...Object.values(links));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 250, display: "block" }}>
      <defs>
        <marker id="sw-arrow" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0, 7 3, 0 6" fill={T.textMuted} /></marker>
      </defs>
      {agents.map((a) => (
        <line key={`c-${a.name}`} x1={cx} y1={cy} x2={pos[a.name].x} y2={pos[a.name].y} stroke={active === a.name ? pos[a.name].color : T.border} strokeWidth={active === a.name ? 1.5 : 1} strokeDasharray="3 4" opacity={0.7} />
      ))}
      {Object.entries(links).map(([k, count]) => {
        const [from, to] = k.split(">");
        const a = pos[from], b = pos[to];
        if (!a || !b) return null;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * 4, ny = dx / len * 4; // offset so A>B and B>A do not overlap
        const sx = a.x + (dx / len) * 24 + nx, sy = a.y + (dy / len) * 24 + ny;
        const ex = b.x - (dx / len) * 28 + nx, ey = b.y - (dy / len) * 28 + ny;
        return <line key={k} x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color} strokeWidth={1 + (count / maxCount) * 3} opacity={0.75} markerEnd="url(#sw-arrow)" />;
      })}
      <circle cx={cx} cy={cy} r={26} fill={T.surfaceAlt} stroke={T.borderLight} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill={T.textMuted} fontFamily={MONO}>PROBLEM</text>
      {agents.map((a) => {
        const p = pos[a.name];
        const isActive = active === a.name;
        const below = p.y >= cy;
        return (
          <g key={a.name}>
            {isActive && (
              <circle cx={p.x} cy={p.y} r={24} fill="none" stroke={p.color} strokeWidth={2}>
                <animate attributeName="r" values="24;34;24" dur="1.3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0;0.9" dur="1.3s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={p.x} cy={p.y} r={22} fill={`${p.color}33`} stroke={p.color} strokeWidth={isActive ? 3 : 1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={p.color} fontFamily={MONO}>{a.name.slice(0, 2).toUpperCase()}</text>
            <text x={p.x} y={below ? p.y + 38 : p.y - 30} textAnchor="middle" fontSize="10" fill={isActive ? T.text : T.textMuted} fontFamily={MONO}>{a.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function TranscriptItem({ e, color }) {
  if (e.kind === "system") {
    return <div style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic", margin: "8px 0", padding: "6px 10px", borderLeft: `2px solid ${T.borderLight}` }}>{e.content}</div>;
  }
  if (e.kind === "tool") {
    return (
      <div style={{ margin: "6px 0 10px 18px", background: "rgba(255,159,67,0.06)", border: `1px solid ${T.orange}30`, borderRadius: 8, padding: "6px 10px" }}>
        <div style={{ fontSize: 10, color: T.orange, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>⚙ {e.agent} used {e.tool}</div>
        {e.params && Object.keys(e.params).length > 0 && <pre style={{ margin: "4px 0 0", fontSize: 10, color: T.textMuted, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{clip(JSON.stringify(e.params), 400)}</pre>}
        <pre style={{ margin: "4px 0 0", fontSize: 11, color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: MONO }}>{e.result}</pre>
      </div>
    );
  }
  return (
    <div style={{ margin: "0 0 12px", borderLeft: `3px solid ${color}`, background: `${color}10`, borderRadius: "0 10px 10px 0", padding: "8px 12px" }}>
      <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{e.agent} · round {e.round}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}><Markdown text={e.content} /></div>
    </div>
  );
}

export default function WhatIfView({ settings, updateSettings, selectedModel, connected }) {
  const [lastRun, setLastRun] = usePersistentState("swarm-last", null);
  const [problem, setProblem] = useState(lastRun?.problem || "");
  const [maxAgents, setMaxAgents] = useState(4);
  const [rounds, setRounds] = useState(2);
  const [phase, setPhase] = useState(lastRun?.report ? "done" : "idle");
  const [plan, setPlan] = useState(lastRun?.plan || null);
  const [transcript, setTranscript] = useState(lastRun?.transcript || []);
  const [report, setReport] = useState(lastRun?.report || "");
  const [active, setActive] = useState(null);
  const [links, setLinks] = useState(lastRun?.links || {});
  const [progress, setProgress] = useState("");
  const [tab, setTab] = useState(lastRun?.report ? "report" : "live");
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const approvalRef = useRef(null);
  const scrollRef = useRef(null);

  const busy = ["planning", "coding", "review", "discussing", "synthesizing"].includes(phase);

  useEffect(() => {
    if (tab === "live") scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript.length, tab]);

  const agentColor = (name) => {
    const i = plan?.agents.findIndex((a) => a.name === name) ?? -1;
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  };

  const stop = () => {
    approvalRef.current?.(false);
    abortRef.current?.abort();
  };

  const reset = () => {
    setPlan(null); setTranscript([]); setReport(""); setLinks({}); setActive(null); setPhase("idle"); setTab("live"); setError(null);
  };

  // ── fix or confirm one generated tool ──
  const prepareTool = async (tool, ctx) => {
    let current = { ...tool };
    let repaired = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await runInSandbox(current.code, current.example_args || {}, 4000);
      const empty = res.ok && (res.result === null || res.result === undefined) && !(res.logs || []).length;
      if (res.ok && !empty) {
        return { ...current, status: repaired ? "repaired" : "ok", sample: formatSandboxResult(res, 300) };
      }
      const error = empty ? "The code returned nothing. It must `return` a JSON-serializable value." : res.error;
      if (attempt === 2) return { ...current, status: "failed", error };
      try {
        const fixed = await chatOnce({
          base: ctx.base, model: ctx.model, signal: ctx.signal, format: "json",
          options: modelOptions(ctx.settings, { temperature: 0.2 }),
          messages: [
            { role: "system", content: 'You repair JavaScript tool code. The code is the BODY of a function that receives one object named `args` and must `return` a JSON-serializable value. No imports, no network, no DOM. Reply with JSON only: {"code": "<fixed function body>"}' },
            { role: "user", content: `Tool: ${current.name}: ${current.description}\nExample args: ${JSON.stringify(current.example_args)}\n\nCode:\n${current.code}\n\nProblem: ${error}` },
          ],
        });
        const j = extractJson(fixed);
        if (!j || typeof j.code !== "string" || !j.code.trim()) return { ...current, status: "failed", error };
        current = { ...current, code: wrapIfFunction(j.code) };
        repaired = true;
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return { ...current, status: "failed", error };
      }
    }
    return { ...current, status: "failed", error: "unknown" };
  };

  // ── the whole run ──
  const start = async () => {
    if (!problem.trim() || busy || !connected || !selectedModel) return;
    reset();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const signal = ctrl.signal;
    const base = settings.ollamaUrl;
    const model = selectedModel;
    const ctx = { base, model, settings, signal };
    const nRounds = Math.min(4, Math.max(1, rounds));
    const log = []; // mirror of the transcript for building prompts
    let finalPlan = null;
    let finalReport = "";
    let linkMirror = {};

    const push = (entry) => {
      log.push({ id: uid(), ...entry });
      setTranscript([...log]);
    };
    const bump = (from, to) => {
      const k = `${from}>${to}`;
      linkMirror = { ...linkMirror, [k]: (linkMirror[k] || 0) + 1 };
      setLinks(linkMirror);
    };

    try {
      // 1. plan
      setPhase("planning");
      setProgress("Designing the swarm…");
      let raw = null;
      try {
        const txt = await chatOnce({
          base, model, signal, format: "json",
          options: modelOptions(settings, { temperature: 0.4 }),
          messages: [
            {
              role: "system",
              content: `You design a swarm of AI agents that performs a WHAT-IF ANALYSIS. Reply with JSON only, in exactly this shape:
{
  "summary": "one sentence on the approach",
  "scenarios": [{"name": "Baseline", "description": "..."}, {"name": "...", "description": "..."}],
  "agents": [{"name": "Analyst", "role": "...", "instructions": "what this agent focuses on", "tools": ["web_search"]}],
  "tools": [{"name": "npv_calc", "description": "what it computes", "params": ["rate", "years"], "example_args": {"rate": 0.08, "years": 5}, "code": "const {rate, years} = args; let total = 0; for (let y = 1; y <= years; y++) total += 100 / Math.pow(1 + rate, y); return {npv: total};"}]
}
Rules:
- 2 to 4 scenarios. The first is the baseline; the others are the what-ifs to compare.
- 3 to ${maxAgents} agents with different viewpoints (for example analyst, skeptic, quantitative modeler, domain expert). Agent names are one word, letters only.
- "tools": 0 to 3 custom JavaScript tools that help with this problem (calculators, simulations, scoring models). "code" is the BODY of a function that receives one object named args and must return a JSON-serializable value. No imports, no network, no DOM, under 25 lines. "example_args" must work with the code.
- Agents can also use built-in tools: web_search and execute_code.
- Output nothing except the JSON.`,
            },
            { role: "user", content: `PROBLEM:\n${problem.trim()}` },
          ],
        });
        raw = extractJson(txt);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error(`Could not reach the model: ${e.message}`);
      }
      let p = normalizePlan(raw, maxAgents);
      if (!raw) push({ kind: "system", content: "The model did not return a usable plan, so a default team of agents was used." });
      setPlan(p);

      // 2. code and test the tools
      if (p.tools.length) {
        setPhase("coding");
        const built = [];
        for (let i = 0; i < p.tools.length; i++) {
          setProgress(`Testing tool ${p.tools[i].name}…`);
          built.push(await prepareTool(p.tools[i], ctx));
          p = { ...p, tools: [...built, ...p.tools.slice(built.length)] };
          setPlan(p);
        }
      }
      finalPlan = p;

      // 3. review
      if (settings.reviewSwarmPlan) {
        setPhase("review");
        setTab("plan");
        setProgress("Waiting for your approval");
        const ok = await new Promise((res) => { approvalRef.current = res; });
        approvalRef.current = null;
        if (!ok || signal.aborted) { setPhase("idle"); setProgress(""); return; }
      }

      // 4. discussion
      const usable = [...BUILTIN_TOOLS, ...p.tools.filter((t) => t.status === "ok" || t.status === "repaired")];
      const toolList = usable.map((t) => `- ${t.name}(${(t.params || []).join(", ")}): ${t.description}`).join("\n");
      const team = p.agents.map((a) => `- ${a.name}: ${a.role}`).join("\n");
      const scenarios = p.scenarios.map((s) => `- ${s.name}: ${s.description}`).join("\n");

      const digest = (maxChars = 6000) => {
        const lines = log.filter((e) => e.kind !== "system").map((e) =>
          e.kind === "tool" ? `[${e.agent} used ${e.tool}] ${clip(e.result, 300)}` : `${e.agent} (round ${e.round}): ${e.content}`
        );
        const out = [];
        let total = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
          const l = clip(lines[i], 900);
          if (total + l.length > maxChars) { out.unshift("[earlier discussion omitted]"); break; }
          out.unshift(l);
          total += l.length;
        }
        return out.join("\n\n");
      };

      let lastSpeaker = null;
      const agentTurn = async (agent, round) => {
        const system = `You are ${agent.name}, ${agent.role}, in a swarm of AI agents doing a WHAT-IF ANALYSIS together.

PROBLEM:
${problem.trim()}

SCENARIOS TO COMPARE:
${scenarios}

TEAM:
${team}

YOUR FOCUS: ${agent.instructions}

TOOLS (optional, use only when they add real evidence):
${toolList}
To call a tool, reply with ONLY these two lines:
TOOL: tool_name
PARAMS: {"param": "value"}
Otherwise reply with your contribution as plain text, at most 150 words. Mention teammates as @Name when you build on or challenge their points. Be concrete: use numbers and name the scenarios.`;
        const d = digest();
        const msgs = [
          { role: "system", content: system },
          { role: "user", content: `${d ? `Discussion so far:\n\n${d}` : "You speak first."}\n\nRound ${round} of ${nRounds}. ${round === nRounds ? "This is the final round: state your final position and a concrete recommendation." : "Add your analysis and respond to your teammates."} Your turn, ${agent.name}.` },
        ];
        for (let t = 0; t < 3; t++) {
          const reply = await chatOnce({ base, model, signal, messages: msgs, options: modelOptions(settings, { temperature: 0.7 }) });
          const call = t < 2 ? parseToolCall(reply) : null;
          if (call) {
            const tool = usable.find((x) => x.name === call.name);
            let out;
            if (!tool) out = `ERROR: unknown tool "${call.name}". Available: ${usable.map((x) => x.name).join(", ")}`;
            else if (tool.custom) out = formatSandboxResult(await runInSandbox(tool.code, call.params, 5000), 1500);
            else out = await runTool(call.name, call.params, ctx);
            push({ kind: "tool", agent: agent.name, tool: call.name, params: call.params, result: clip(out, 1200), round });
            msgs.push({ role: "assistant", content: reply });
            msgs.push({ role: "user", content: `TOOL RESULT (${call.name}):\n${clip(out, 1500)}\n\n${t >= 1 ? "Now give your contribution without calling more tools." : "Now give your contribution, or call one more tool if essential."}` });
            continue;
          }
          const text = reply.replace(/^\s*(TOOL|PARAMS):.*$/gim, "").trim() || "(no contribution)";
          push({ kind: "message", agent: agent.name, content: text, round });
          const names = p.agents.map((a) => a.name);
          const mentioned = new Set();
          for (const m of text.matchAll(/@([A-Za-z0-9_]+)/g)) {
            const hit = names.find((n) => n.toLowerCase() === m[1].toLowerCase());
            if (hit && hit !== agent.name) mentioned.add(hit);
          }
          if (mentioned.size) mentioned.forEach((to) => bump(agent.name, to));
          else if (lastSpeaker && lastSpeaker !== agent.name) bump(agent.name, lastSpeaker);
          lastSpeaker = agent.name;
          return;
        }
      };

      setPhase("discussing");
      setTab("live");
      for (let r = 1; r <= nRounds; r++) {
        for (const agent of p.agents) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          setActive(agent.name);
          setProgress(`Round ${r} of ${nRounds}: ${agent.name} is working`);
          await agentTurn(agent, r);
        }
      }
      setActive(null);

      // 5. report
      setPhase("synthesizing");
      setProgress("Writing the report…");
      setTab("report");
      finalReport = await chatStream({
        base, model, signal,
        options: modelOptions(settings, { temperature: 0.4 }),
        onToken: (_t, full) => setReport(full),
        messages: [
          {
            role: "system",
            content: `You are the Synthesizer of a what-if analysis swarm. Write the final report in Markdown using exactly these sections:
# <short title>
## Bottom line
Two or three sentences with the recommendation.
## Scenario comparison
A Markdown table with columns: Scenario | Key assumptions | Upside | Risks | Verdict.
## Where the team agreed
## Where the team disagreed
## Risks and unknowns
## Next steps
A numbered list.
Use only facts and numbers that appear in the discussion or tool results. Label estimates as estimates. Do not invent data.`,
          },
          { role: "user", content: `PROBLEM:\n${problem.trim()}\n\nSCENARIOS:\n${scenarios}\n\nTEAM:\n${team}\n\nDISCUSSION:\n${digest(9000)}` },
        ],
      });
      setPhase("done");
      setProgress("");
    } catch (e) {
      setActive(null);
      if (e.name === "AbortError") {
        setPhase(finalReport || report ? "done" : "idle");
        setProgress("");
        push({ kind: "system", content: "Stopped." });
      } else {
        setError(e.message);
        setPhase("error");
        setProgress("");
      }
    } finally {
      if (finalPlan && (log.length || finalReport)) {
        setLastRun({ problem: problem.trim(), plan: finalPlan, transcript: log, report: finalReport, links: linkMirror, at: Date.now() });
      }
    }
  };

  const exportMarkdown = () => {
    const md = [
      `# What-if analysis`,
      `**Problem:** ${problem}`,
      plan ? `## Plan\n${plan.summary}\n\n### Scenarios\n${plan.scenarios.map((s) => `- **${s.name}**: ${s.description}`).join("\n")}\n\n### Agents\n${plan.agents.map((a) => `- **${a.name}** (${a.role}): ${a.instructions}`).join("\n")}` : "",
      plan?.tools?.length ? `### Generated tools\n${plan.tools.map((t) => `**${t.name}** (${t.status}): ${t.description}\n\`\`\`js\n${t.code}\n\`\`\``).join("\n\n")}` : "",
      `## Discussion\n${transcript.filter((e) => e.kind !== "system").map((e) => (e.kind === "tool" ? `> ${e.agent} used \`${e.tool}\`: ${e.result}` : `**${e.agent}** (round ${e.round}): ${e.content}`)).join("\n\n")}`,
      report ? `## Report\n${report}` : "",
    ].filter(Boolean).join("\n\n");
    downloadText("what-if-analysis.md", md, "text/markdown");
  };

  const statusColor = phase === "error" ? T.red : phase === "done" ? T.green : T.orange;
  const toolStatusColor = (s) => (s === "ok" ? T.green : s === "repaired" ? T.orange : s === "failed" ? T.red : T.textMuted);

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Left: problem + controls */}
      <div style={{ width: 320, borderRight: `1px solid ${T.border}`, padding: 16, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flexShrink: 0 }}>
        <div>
          <label style={labelStyle}>Problem to analyse</label>
          <textarea value={problem} onChange={(e) => setProblem(e.target.value)} disabled={busy} rows={6} placeholder="Describe the situation and the what-if questions you care about…" style={{ ...inputBase, fontSize: 12, resize: "vertical", lineHeight: 1.5 }} />
        </div>
        {!busy && !problem && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={labelStyle}>Try an example</div>
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setProblem(ex)} style={{ ...btnBase, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textMuted, fontSize: 11, padding: "7px 10px", textAlign: "left", lineHeight: 1.4 }}>{ex}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Agents (max)</label>
            <input type="number" min={3} max={6} value={maxAgents} disabled={busy} onChange={(e) => setMaxAgents(Math.min(6, Math.max(3, +e.target.value || 4)))} style={{ ...inputBase, fontSize: 12, padding: "6px 10px" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Rounds</label>
            <input type="number" min={1} max={4} value={rounds} disabled={busy} onChange={(e) => setRounds(Math.min(4, Math.max(1, +e.target.value || 2)))} style={{ ...inputBase, fontSize: 12, padding: "6px 10px" }} />
          </div>
        </div>
        <label style={{ display: "flex", gap: 8, fontSize: 11, color: T.textMuted, cursor: "pointer", lineHeight: 1.5 }}>
          <input type="checkbox" checked={settings.reviewSwarmPlan} disabled={busy} onChange={(e) => updateSettings({ reviewSwarmPlan: e.target.checked })} style={{ marginTop: 2 }} />
          Ask me to approve the plan and generated tool code before agents start
        </label>
        {busy ? (
          <button onClick={stop} style={{ ...btnBase, background: T.red, color: "#fff", padding: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon d={Icons.stop} size={14} color="#fff" /> Stop
          </button>
        ) : (
          <button onClick={start} disabled={!problem.trim() || !connected} style={{ ...btnBase, background: problem.trim() && connected ? T.accent : T.border, color: "#fff", padding: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: problem.trim() && connected ? 1 : 0.5 }}>
            <Icon d={Icons.swarm} size={14} color="#fff" /> Run swarm
          </button>
        )}
        {!connected && <div style={{ fontSize: 11, color: T.orange }}>Ollama is not connected. The swarm needs a running model.</div>}
        {(progress || phase !== "idle") && (
          <div style={{ fontSize: 11, color: statusColor, display: "flex", gap: 6, alignItems: "center" }}>
            {busy && <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>}
            {progress || (phase === "done" ? "Finished" : phase === "error" ? "Failed" : "")}
          </div>
        )}
        {error && <Banner onClose={() => setError(null)}>{error}</Banner>}
        <div style={{ fontSize: 10, color: T.textDim, lineHeight: 1.6, marginTop: "auto" }}>
          The model designs the team, writes any tools it needs as JavaScript, and tests them in a sandbox. Agents then discuss in turns and a synthesizer writes the report. Small models work but give shallower results; larger ones (8B and up) follow the format more reliably.
        </div>
      </div>

      {/* Right: tabs */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 16px", borderBottom: `1px solid ${T.border}` }}>
          {[["live", "Live"], ["plan", "Plan & tools"], ["report", "Report"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ ...btnBase, background: tab === id ? T.accentGlow : "transparent", border: `1px solid ${tab === id ? "rgba(108,92,231,0.4)" : "transparent"}`, color: tab === id ? T.accentSoft : T.textMuted, padding: "5px 12px", fontSize: 12 }}>{label}</button>
          ))}
          <div style={{ flex: 1 }} />
          {(transcript.length > 0 || report) && !busy && (
            <>
              <SmallBtn onClick={exportMarkdown}><Icon d={Icons.download} size={11} color={T.textMuted} /> Export</SmallBtn>
              <SmallBtn onClick={() => { reset(); setLastRun(null); }}>Clear</SmallBtn>
            </>
          )}
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {tab === "live" && (
            plan ? (
              <>
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 8, marginBottom: 14 }}>
                  <SwarmGraph agents={plan.agents} active={active} links={links} />
                </div>
                {transcript.map((e) => <TranscriptItem key={e.id} e={e} color={agentColor(e.agent)} />)}
                {transcript.length === 0 && <div style={{ fontSize: 12, color: T.textDim }}>The discussion will appear here.</div>}
              </>
            ) : (
              <Empty glyph="⬢" title="What-if analysis swarm">
                Describe a problem and the questions you want answered. The model builds a team of agents with different viewpoints, writes any calculators it needs, and the agents work the problem out together.
              </Empty>
            )
          )}

          {tab === "plan" && (
            plan ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {phase === "review" && (
                  <div style={{ background: "rgba(255,159,67,0.08)", border: `1px solid ${T.orange}50`, borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.orange, marginBottom: 6 }}>Review before running</div>
                    <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, marginBottom: 10 }}>
                      The model wrote the agents and tool code below. Tool code runs in a sandboxed worker with a 5 second limit and no network access, but read it before you approve.
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => approvalRef.current?.(true)} style={{ ...btnBase, background: T.green, color: "#fff", padding: "8px 16px" }}>Approve and run</button>
                      <button onClick={() => approvalRef.current?.(false)} style={{ ...btnBase, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textMuted, padding: "8px 16px" }}>Cancel</button>
                    </div>
                  </div>
                )}
                {plan.summary && <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{plan.summary}</div>}
                <div>
                  <div style={labelStyle}>Scenarios</div>
                  {plan.scenarios.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${T.border}` }}>
                      <strong style={{ color: i === 0 ? T.green : T.text }}>{s.name}</strong>{i === 0 && <span style={{ color: T.textDim }}> (baseline)</span>}
                      <div style={{ color: T.textMuted }}>{s.description}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={labelStyle}>Agents</div>
                  {plan.agents.map((a, i) => (
                    <div key={a.name} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ width: 8, borderRadius: 4, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                      <div style={{ fontSize: 12, minWidth: 0 }}>
                        <strong>{a.name}</strong> <span style={{ color: T.textMuted }}>· {a.role}</span>
                        <div style={{ color: T.textMuted, lineHeight: 1.5 }}>{a.instructions}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={labelStyle}>Generated tools</div>
                  {plan.tools.length === 0 && <div style={{ fontSize: 12, color: T.textDim }}>None. Agents use the built-in web_search and execute_code.</div>}
                  {plan.tools.map((t) => (
                    <details key={t.name} style={{ border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 8, background: T.surfaceAlt }} open={phase === "review"}>
                      <summary style={{ cursor: "pointer", padding: "8px 12px", fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                        <strong>{t.name}</strong>
                        <span style={{ color: toolStatusColor(t.status), fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{t.status === "pending" ? "testing…" : t.status}</span>
                        <span style={{ color: T.textDim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</span>
                      </summary>
                      <pre style={{ margin: 0, padding: "10px 12px", borderTop: `1px solid ${T.border}`, fontSize: 11, overflowX: "auto", background: "#0d0d15" }}>{t.code}</pre>
                      {t.sample && <div style={{ padding: "6px 12px", fontSize: 11, color: T.green, borderTop: `1px solid ${T.border}`, whiteSpace: "pre-wrap" }}>Test output: {t.sample}</div>}
                      {t.error && <div style={{ padding: "6px 12px", fontSize: 11, color: T.red, borderTop: `1px solid ${T.border}`, whiteSpace: "pre-wrap" }}>Test failed: {t.error}. This tool will not be offered to the agents.</div>}
                    </details>
                  ))}
                </div>
              </div>
            ) : (
              <Empty glyph="⬢" title="No plan yet">Run the swarm to see the agents and tools the model designs.</Empty>
            )
          )}

          {tab === "report" && (
            report ? (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}><CopyBtn text={report} label="Copy report" /></div>
                <div style={{ fontSize: 13, lineHeight: 1.65 }}><Markdown text={report} /></div>
              </div>
            ) : (
              <Empty glyph="▤" title="No report yet">The synthesizer writes the report after the discussion.</Empty>
            )
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
