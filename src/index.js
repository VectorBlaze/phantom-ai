import fs   from "fs/promises";
import path from "path";

const SKILLS_DIR = path.join(process.cwd(), "skills");

async function loadSkills() {
  try {
    const files = await fs.readdir(SKILLS_DIR);
    const mds   = files.filter(f => f.toLowerCase().endsWith(".md"));
    const skills = [];
    for (const file of mds) {
      try {
        const content = await fs.readFile(path.join(SKILLS_DIR, file), "utf8");
        skills.push({ name: file.replace(/\.md$/i, ""), content });
      } catch {}
    }
    return skills;
  } catch {
    return [];
  }
}

export async function resolveSkills(userMessage = "") {
  const skills = await loadSkills();
  if (!skills.length) return "No skills installed.";

  const query = userMessage.toLowerCase();
  const words = query.split(/\s+/).filter(w => w.length >= 4);

  const relevant = skills.filter(skill => {
    const text = (skill.name + "\n" + skill.content).toLowerCase();
    return words.some(w => text.includes(w));
  });

  if (!relevant.length) return "No specifically relevant skills found.";

  return relevant
    .map(s => `## SKILL: ${s.name}\n\n${s.content}`)
    .join("\n\n---\n\n");
}
