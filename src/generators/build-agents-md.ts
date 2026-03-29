import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./path-mapper.js";

export interface AgentDefinition {
  name: string;
  description: string;
  skills?: string[];
  tools?: string[];
}

/**
 * Parse an agent definition from either:
 * - Legacy format: YAML frontmatter with `name`, `description`, `skills` fields
 * - New format: Markdown heading `# Name Agent Context` + `**Role**: description`
 */
export function parseAgentDefinition(content: string, filename: string): AgentDefinition {
  // Try legacy YAML frontmatter format first
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1] ?? "";
    const name = filename.replace(".md", "");

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    const description = descMatch?.[1]?.trim() ?? "No description available";

    const skillsMatch = frontmatter.match(/^skills:\s*\n((?:\s+-\s*.+\n?)+)/m);
    const skills: string[] = [];
    if (skillsMatch) {
      const skillsLines = skillsMatch[1]?.split("\n") ?? [];
      for (const line of skillsLines) {
        const skillMatch = line.match(/^\s+-\s*(.+)$/);
        if (skillMatch) {
          skills.push(skillMatch[1]?.trim() ?? "");
        }
      }
    }

    return {
      name,
      description,
      skills: skills.length > 0 ? skills : undefined,
      tools: [],
    };
  }

  // Try new markdown format: `# Name Agent Context` + `**Role**: description`
  const headingMatch = content.match(/^# (.+?) Agent Context$/m);
  const roleMatch = content.match(/^\*\*Role\*\*:\s*(.+)$/m);

  const name = headingMatch
    ? headingMatch[1]!.trim()
    : filename.replace(/Context\.md$/, "").replace(/\.md$/, "");

  const description = roleMatch
    ? roleMatch[1]!.trim()
    : "No description available";

  return {
    name,
    description,
    skills: [],
    tools: [],
  };
}

/**
 * Generate a markdown summary of all available PAI agents.
 *
 * Checks new path (`skills/Agents/`) first for `*Context.md` files,
 * then falls back to legacy path (`agents/`) for `*.md` files.
 */
export async function generateAgentsMD(paiDir?: string): Promise<string> {
  const rootDir = paiDir || PATHS.PAI_ROOT();

  // Try new path first: skills/Agents/*Context.md
  const newAgentsDir = join(rootDir, "skills", "Agents");
  const legacyAgentsDir = join(rootDir, "agents");

  let files: string[];
  let agentsDir: string = legacyAgentsDir;

  if (existsSync(newAgentsDir)) {
    agentsDir = newAgentsDir;
    try {
      files = readdirSync(newAgentsDir).filter(
        f => f.endsWith("Context.md")
      );
    } catch {
      files = [];
    }
  } else {
    files = [];
  }

  // Fall back to legacy path if new path has no context files
  if (files.length === 0) {
    agentsDir = legacyAgentsDir;
    try {
      files = readdirSync(legacyAgentsDir).filter(f => f.endsWith(".md"));
    } catch {
      throw new Error(`Failed to read agents directory: ${legacyAgentsDir}`);
    }
  }

  const agents: AgentDefinition[] = [];

  for (const file of files) {
    const filePath = join(agentsDir, file);
    const content = readFileSync(filePath, "utf-8");
    const agent = parseAgentDefinition(content, file);
    agents.push(agent);
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));

  let markdown = "# Agents\n\n";
  markdown += `Total: ${agents.length} agents\n\n`;

  for (const agent of agents) {
    markdown += `## ${agent.name}\n\n`;
    markdown += `${agent.description}\n\n`;

    if (agent.skills && agent.skills.length > 0) {
      markdown += `**Skills:** ${agent.skills.join(", ")}\n\n`;
    }
  }

  return markdown;
}
