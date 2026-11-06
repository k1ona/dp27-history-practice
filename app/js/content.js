// Loads bundled content. Every file is pre-cached by the service worker, so this works offline.

const cache = new Map();

async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  try { return await p; } catch (e) { cache.delete(path); throw e; }
}

export const content = {
  config: () => getJSON("config.json"),
  map: () => getJSON("content/sections.json"),
  available: () => getJSON("content/available.json").catch(() => ({ sections: [] })),
  markbands: () => getJSON("content/_markbands.json"),
  credits: () => getJSON("content/_media/credits.json").catch(() => ({ media: [] })),
  section: (id) => getJSON(`content/sections/${id}.json`),
  async record(id) {
    const m = await content.map();
    return m.sections.find((s) => s.sectionId === id) || null;
  },
  async media(id) {
    const c = await content.credits();
    return c.media.find((m) => m.mediaId === id) || null;
  },
  async crossLinksFor(id) {
    const m = await content.map();
    return m.crossLinks.filter((x) => x.sectionIds.includes(id));
  },
};

/** Find an essay question or a Paper 1 question part anywhere in a section. */
export function findQuestion(section, questionId) {
  for (const q of section.essayQuestions || []) if (q.questionId === questionId) return { kind: "essay", q };
  for (const set of section.sourceSets || [])
    for (const q of set.questions) if (q.questionId === questionId) return { kind: "p1", q, set };
  return null;
}
