import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUidAndOrgFromToken } from "@/lib/db";

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

    const prompt = `You are an expert at analyzing AI voice bot system prompts and generating conversation flow diagrams.

Analyze the following system prompt${fileContent ? " and supplementary file content" : ""} and generate a Mermaid flowchart that visualizes the conversation flow.

## System Prompt
${systemPrompt}
${fileContent ? `\n## Supplementary File Content\n${fileContent.slice(0, 8000)}` : ""}

## Instructions
- Generate a Mermaid flowchart using \`graph TD\` syntax
- Show the main conversation phases/stages as nodes
- Show decision points (e.g. customer objections, interest levels) as diamond nodes
- Show transitions between phases with labeled edges
- Include key actions the bot takes at each stage
- Keep it readable — aim for 10-25 nodes maximum
- Use descriptive but concise node labels
- Do NOT wrap in code fences — return ONLY the raw Mermaid syntax starting with "graph TD"

Respond with ONLY the Mermaid flowchart syntax, nothing else.`;

    const genResult = await model.generateContent(prompt);
    let mermaidCode = genResult.response.text().trim();

    // Strip code fences if present
    mermaidCode = mermaidCode
      .replace(/^```mermaid?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    // Ensure it starts with a valid graph directive
    if (!mermaidCode.match(/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)/)) {
      // Try to find the graph line within the output
      const match = mermaidCode.match(/((?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)[\s\S]*)/);
      if (match) {
        mermaidCode = match[1];
      }
    }

    // Sanitize: remove problematic characters in node labels
    // Replace smart quotes with regular quotes
    mermaidCode = mermaidCode
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");

    return NextResponse.json({ mermaidCode });
  } catch (error) {
    console.error("[generate-flow] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate flow" },
      { status: 500 }
    );
  }
}
