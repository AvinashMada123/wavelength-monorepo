import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUidAndOrgFromToken } from "@/lib/db";

/**
 * Sanitize Mermaid syntax to avoid common parse errors.
 * Mermaid is very strict about special characters inside node labels.
 */
function sanitizeMermaid(raw: string): string {
  let code = raw.trim();

  // Strip code fences
  code = code.replace(/^```(?:mermaid)?\s*\n?/, "").replace(/\n?\s*```$/, "").trim();

  // Extract graph/flowchart block if buried in extra text
  if (!code.match(/^(?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)/)) {
    const match = code.match(/((?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)[\s\S]*)/);
    if (match) code = match[1];
  }

  // Replace smart quotes
  code = code.replace(/[\u201C\u201D\u00AB\u00BB]/g, '"').replace(/[\u2018\u2019\u2032]/g, "'");

  // Replace em/en dashes with regular hyphens
  code = code.replace(/[\u2013\u2014]/g, "-");

  // Replace ellipsis
  code = code.replace(/\u2026/g, "...");

  // Fix node labels: Mermaid chokes on special chars in labels.
  // Ensure text inside brackets/parens doesn't contain unescaped special chars.
  // Replace ( ) inside square bracket labels with nothing (they conflict with node syntax)
  code = code.split("\n").map((line) => {
    // Skip lines that are just the graph directive or subgraph/end
    if (line.match(/^\s*(graph|flowchart|subgraph|end)\b/)) return line;

    // For lines with node definitions like A[Label text] or A{Label text}
    // Remove any # characters that aren't part of HTML entities
    line = line.replace(/#(?![a-zA-Z]+;)/g, "");

    return line;
  }).join("\n");

  return code;
}

export async function POST(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { systemPrompt, fileContent } = await request.json();
    if (!systemPrompt?.trim()) {
      return NextResponse.json(
        { error: "System prompt is required" },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `You are an expert at generating Mermaid.js flowcharts from AI voice bot system prompts.

Analyze the following system prompt${fileContent ? " and supplementary file content" : ""} and generate a Mermaid flowchart.

## System Prompt
${systemPrompt.slice(0, 6000)}
${fileContent ? `\n## Supplementary File Content\n${fileContent.slice(0, 8000)}` : ""}

## STRICT Mermaid Syntax Rules — you MUST follow these:
1. Start with exactly: graph TD
2. Node IDs must be simple alphanumeric like A, B, C1, D2 — NO spaces or special chars in IDs
3. Node labels go in square brackets: A[Label Text Here]
4. Decision nodes use curly braces: D1{Is customer interested?}
5. Edges use arrows: A --> B or A -->|edge label| B
6. Do NOT use parentheses () in node labels — they conflict with Mermaid syntax
7. Do NOT use quotes inside node labels
8. Do NOT use special characters like #, &, <, >, @, $, % in labels
9. Keep labels short — max 6-8 words per node
10. Use only plain ASCII text in labels — no unicode, no emojis
11. Aim for 10-20 nodes maximum
12. Every node ID used in an edge must be defined with a label

## Example of VALID syntax:
graph TD
    A[Start: Greeting] --> B[Introduce Self]
    B --> C{Customer Interested?}
    C -->|Yes| D[Present Offer]
    C -->|No| E[Handle Objection]
    D --> F[Close Call]
    E --> C

Respond with ONLY the raw Mermaid flowchart. No explanation, no code fences, no markdown.`;

    const genResult = await model.generateContent(prompt);
    const mermaidCode = sanitizeMermaid(genResult.response.text());

    return NextResponse.json({ mermaidCode });
  } catch (error) {
    console.error("[generate-flow] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate flow" },
      { status: 500 }
    );
  }
}
