import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUidAndOrgFromToken } from "@/lib/db";

/**
 * Sanitize Mermaid syntax to avoid common parse errors.
 * Mermaid is extremely strict about special characters.
 */
function sanitizeMermaid(raw: string): string {
  let code = raw.trim();

  // Strip code fences (``` or ```mermaid)
  code = code.replace(/^```(?:mermaid)?\s*\n?/gm, "").replace(/\n?\s*```$/gm, "").trim();

  // Extract graph/flowchart block if buried in extra text
  if (!code.match(/^(?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)/)) {
    const match = code.match(/((?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)[\s\S]*)/);
    if (match) code = match[1];
  }

  // Replace smart quotes, em/en dashes, ellipsis
  code = code.replace(/[\u201C\u201D\u00AB\u00BB]/g, '"').replace(/[\u2018\u2019\u2032]/g, "'");
  code = code.replace(/[\u2013\u2014]/g, "-");
  code = code.replace(/\u2026/g, "...");

  // Fix edges pointing to subgraph: "S6 --> subgraph P3[...]" -> split into separate lines
  code = code.replace(/^(\s*\S+\s+-->[^\n]*?)\s+subgraph\s+/gm, "$1\n    subgraph ");

  // Fix "end" on same line as anything: "S1 --> S2 end", "D7 -->|No| S31 end"
  code = code.replace(/^(.+?)\s+end\s*$/gm, (_, before) => {
    const b = before.trim();
    // Only split if "before" looks like a real statement (has node IDs or arrows)
    if (b && !b.match(/^subgraph\b/) && !b.match(/^%%/)) {
      return `${before}\n    end`;
    }
    return `${before} end`;
  });

  const lines = code.split("\n");
  const cleanedLines: string[] = [];
  let subgraphDepth = 0;

  for (let line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("%%")) {
      cleanedLines.push(line);
      continue;
    }

    // Skip graph directive
    if (trimmed.match(/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)/)) {
      cleanedLines.push(line);
      continue;
    }

    // Handle "end" - track subgraph depth
    if (trimmed === "end") {
      if (subgraphDepth > 0) subgraphDepth--;
      cleanedLines.push("    end");
      continue;
    }

    // Fix subgraph lines: ensure they use ID[Label] format
    const subMatch = trimmed.match(/^subgraph\s+([A-Za-z0-9_]+)\[(.+)\]$/);
    if (subMatch) {
      const label = subMatch[2].replace(/[()'"#&<>@$%]/g, "");
      cleanedLines.push(`    subgraph ${subMatch[1]}[${label}]`);
      subgraphDepth++;
      continue;
    }
    const subNoIdMatch = trimmed.match(/^subgraph\s+(.+)$/);
    if (subNoIdMatch) {
      const label = subNoIdMatch[1].replace(/[()'"#&<>@$%]/g, "").trim();
      const id = "SG_" + label.replace(/[^A-Za-z0-9]/g, "_").slice(0, 20);
      cleanedLines.push(`    subgraph ${id}[${label}]`);
      subgraphDepth++;
      continue;
    }

    // Clean labels inside [...] - remove all special chars including curly braces
    line = line.replace(/\[([^\]]+)\]/g, (_match, label: string) => {
      const clean = label.replace(/[()'"#&<>@$%{}]/g, "").replace(/\s+/g, " ").trim();
      return `[${clean}]`;
    });
    // Clean labels inside {...} (decision nodes)
    line = line.replace(/\{([^}]+)\}/g, (_match, label: string) => {
      const clean = label.replace(/[()'"#&<>@$%]/g, "").replace(/\s+/g, " ").trim();
      return `{${clean}}`;
    });

    // Remove any # not part of HTML entities
    line = line.replace(/#(?![a-zA-Z]+;)/g, "");

    // Fix arrow syntax: ensure proper format
    line = line.replace(/--\s*>/g, "-->");
    // Fix "-- text -->" to "-->|text|"
    line = line.replace(/--\s*([^>|][^-]*?)\s*-->/g, "-->|$1|");

    cleanedLines.push(line);
  }

  // Close any unclosed subgraphs
  while (subgraphDepth > 0) {
    cleanedLines.push("    end");
    subgraphDepth--;
  }

  return cleanedLines.join("\n");
}

const FLOW_PROMPT = `You are an expert at generating DETAILED Mermaid.js flowcharts from AI voice bot system prompts.

Analyze the system prompt and generate a comprehensive Mermaid flowchart showing EVERY step, question, and branch.

## REQUIREMENTS:
1. EVERY step or question in the script = its own node
2. EVERY decision point shows ALL branches: Yes, No, Unclear
3. Group steps into phases using subgraph ID[Label] format
4. Show abbreviated but recognizable question/action text
5. Include callback paths and exit points
6. Show where agent waits vs auto-continues

## CRITICAL Mermaid Syntax Rules - MUST follow exactly:
1. First line must be: graph TD
2. Node IDs: simple alphanumeric only like S1, S2, D1, EXIT1
3. Regular nodes: S1[Label text here]
4. Decision nodes: D1{Is customer free?}
5. Arrows: S1 --> S2 or S1 -->|Yes| S2
6. Subgraphs MUST use ID format: subgraph P1[Phase 1 - Greeting]
7. Every subgraph must have matching: end
8. Edges MUST connect node IDs, NEVER connect to subgraph keywords
9. FORBIDDEN in labels: parentheses () curly braces {} quotes "" '' hash # ampersand & angle brackets <> at @ dollar $ percent %. Use plain text only - write customer_name NOT {customer_name}
10. ASCII only - no unicode, no emojis
11. Every node ID in an edge must be defined somewhere with a label
12. No duplicate node definitions - define each node ID only ONCE
13. Each line should contain ONLY ONE statement - never combine edges with subgraph or end

## VALID example:
graph TD
    subgraph P1[Phase 1 - Greeting]
        S1[Greet customer] --> D1{English or Hindi?}
        D1 -->|English| S2[Lock English]
        D1 -->|Hindi| S2H[Lock Hindi]
    end
    S2 --> S3[Ask if free for 5 min]
    S2H --> S3
    subgraph P2[Phase 2 - Setup]
        S3 --> D2{Available now?}
        D2 -->|Yes| S4[Continue setup]
        D2 -->|No| CB[Schedule callback]
        CB --> EXIT1[End call - callback]
    end

Output ONLY raw Mermaid code. No explanation. No code fences. No markdown.`;

export async function POST(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;

    const { systemPrompt, fileContent } = await request.json();
    if (!systemPrompt?.trim()) {
      return NextResponse.json(
        { error: "System prompt is required" },
        { status: 400 },
      );
    }

    const content = `${FLOW_PROMPT}

## System Prompt to analyze:
${systemPrompt.slice(0, 8000)}
${fileContent ? `\n## Supplementary File Content:\n${fileContent.slice(0, 8000)}` : ""}`;

    // Try Claude first (better at structured output), fall back to Gemini
    let mermaidCode = "";
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || "AIzaSyAT_jWNpBGVdd029_Wa2jPHX3iInqNey7w";

    if (anthropicKey) {
      console.log("[generate-flow] Using Anthropic Claude Haiku");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [{ role: "user", content }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text || "";
        mermaidCode = sanitizeMermaid(text);
        console.log("[generate-flow] Anthropic succeeded");
      } else {
        const errText = await res.text();
        console.error("[generate-flow] Anthropic failed:", res.status, errText);
      }
    } else {
      console.log("[generate-flow] No ANTHROPIC_API_KEY, skipping Claude");
    }

    // Fallback to Gemini
    if (!mermaidCode && geminiKey) {
      console.log("[generate-flow] Falling back to Gemini 2.0 Flash");
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const genResult = await model.generateContent(content);
      mermaidCode = sanitizeMermaid(genResult.response.text());
    }

    if (!mermaidCode) {
      return NextResponse.json(
        { error: "No API key configured (ANTHROPIC_API_KEY or GEMINI_API_KEY)" },
        { status: 500 },
      );
    }

    console.log("[generate-flow] Mermaid output:\n" + mermaidCode);
    return NextResponse.json({ mermaidCode });
  } catch (error) {
    console.error("[generate-flow] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate flow" },
      { status: 500 },
    );
  }
}
