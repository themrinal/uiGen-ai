import type { FileNode } from "@/lib/file-system";
import { VirtualFileSystem } from "@/lib/file-system";
import { streamText, appendResponseMessages } from "ai";
import { buildStrReplaceTool } from "@/lib/tools/str-replace";
import { buildFileManagerTool } from "@/lib/tools/file-manager";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getLanguageModel } from "@/lib/provider";
import { generationPrompt } from "@/lib/prompts/generation";

// In-memory rate limiter for anonymous users (20 req/min per IP).
// For multi-instance or production deployments, replace with a persistent store (e.g. Redis/Upstash).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const ANON_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= ANON_RATE_LIMIT) return true;
  entry.count++;
  return false;
}

export async function POST(req: Request) {
  const session = await getSession();

  if (!session) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  const {
    messages,
    files,
    projectId,
  }: { messages: any[]; files: Record<string, FileNode>; projectId?: string } =
    await req.json();

  messages.unshift({
    role: "system",
    content: generationPrompt,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  });

  // Reconstruct the VirtualFileSystem from serialized data
  const fileSystem = new VirtualFileSystem();
  fileSystem.deserializeFromNodes(files);

  const model = getLanguageModel();
  // Use fewer steps for mock provider to prevent repetition
  const isMockProvider = !process.env.ANTHROPIC_API_KEY;
  const result = streamText({
    model,
    messages,
    maxTokens: 10_000,
    maxSteps: isMockProvider ? 4 : 40,
    onError: (err: any) => {
      console.error(err);
    },
    tools: {
      str_replace_editor: buildStrReplaceTool(fileSystem),
      file_manager: buildFileManagerTool(fileSystem),
    },
    onFinish: async ({ response }) => {
      if (!projectId || !session) return;

      try {
        const responseMessages = response.messages || [];
        const allMessages = appendResponseMessages({
          messages: [...messages.filter((m) => m.role !== "system")],
          responseMessages,
        });

        // Verify project ownership before updating (userId is not a unique field,
        // so findFirst is used instead of findUnique)
        const existing = await prisma.project.findFirst({
          where: { id: projectId, userId: session.userId },
          select: { id: true },
        });
        if (!existing) {
          console.error("Project not found or access denied");
          return;
        }

        await prisma.project.update({
          where: { id: projectId },
          data: {
            messages: JSON.stringify(allMessages),
            data: JSON.stringify(fileSystem.serialize()),
          },
        });
      } catch (error) {
        console.error("Failed to save project data:", error);
      }
    },
  });

  return result.toDataStreamResponse();
}

export const maxDuration = 120;
