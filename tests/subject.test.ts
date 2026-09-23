import { describe, expect, it } from "vitest";
import { findSubject, findSubjects, namedPlace } from "@/lib/ask/subject";
import { parseQuery } from "@/lib/ask/parse";
import { ask } from "@/lib/ask/answer";

describe("recognising a place in the question", () => {
  it("survives the way people actually spell reservoir", () => {
    expect(findSubject("pineview resivar")?.trail.name).toBe("Pineview Reservoir");
    expect(findSubject("how is strawberry resevoir")?.trail.name).toBe("Strawberry Reservoir");
  });

  it("finds the water in a typo'd question", () => {
    const match = findSubject("whats the jordan river resivar");
    expect(match?.trail.name).toBe("Jordan River");
  });

  it("offers the other readings of an ambiguous name", () => {
    const names = findSubjects("whats the jordan river resivar").map((m) => m.trail.name);
    expect(names).toContain("Jordanelle Reservoir");
  });

  it("does not mistake a search for a place", () => {
    expect(findSubject("where should i ride near park city")).toBeNull();
    expect(findSubject("a shady hike saturday")).toBeNull();
    expect(namedPlace("where should i ride near park city")).toBeNull();
    expect(namedPlace("a shady hike saturday")).toBeNull();
  });

  it("does not invent a match for a place that isn't there", () => {
    expect(findSubject("whats the fake mcfakeface reservoir")).toBeNull();
    expect(namedPlace("whats the fake mcfakeface reservoir")).toBe("Fake Mcfakeface Reservoir");
  });
});

describe("the query a named place produces", () => {
  it("switches to the activity the place supports", () => {
    const query = parseQuery("whats the jordan river resivar", "2026-09-22");
    expect(query.activity).toBe("fish");
    expect(query.subject).toBeDefined();
    expect(query.interpretation).toMatch(/^about Jordan River/);
  });

  it("marks a place we don't hold", () => {
    const query = parseQuery("whats the fake mcfakeface reservoir", "2026-09-22");
    expect(query.subject).toBeUndefined();
    expect(query.unknownPlace).toBe("Fake Mcfakeface Reservoir");
  });
});

describe("Scout answering about a place", () => {
  it("answers about the place that was named", async () => {
    const answer = await ask({
      question: "whats the jordan river resivar",
      allowLlm: false,
      today: "2026-09-22",
    });
    expect(answer.results[0]?.trail.name).toBe("Jordan River");
    expect(answer.narrative).toMatch(/Jordan River is in/);
    expect(answer.narrative).not.toMatch(/Angels Landing/);
  });

  it("says it doesn't hold a place rather than guessing", async () => {
    const answer = await ask({
      question: "whats the fake mcfakeface reservoir",
      allowLlm: false,
      today: "2026-09-22",
    });
    expect(answer.results).toEqual([]);
    expect(answer.narrative).toMatch(/don't have Fake Mcfakeface Reservoir/);
  });
});

describe("a long question still names its place", () => {
  it("cuts the sentence at the first word that isn't part of a name", () => {
    expect(namedPlace("how is dogwood crag looking this time of day on Friday")).toBe(
      "Dogwood Crag",
    );
    expect(namedPlace("conditions at rock canyon tomorrow")).toBe("Rock Canyon");
    expect(namedPlace("is the ferguson canyon wall dry today")).toBe("Ferguson Canyon Wall");
  });

  it("still refuses to treat a search as a place", () => {
    expect(namedPlace("where should i ride near park city")).toBeNull();
    expect(namedPlace("a shady hike saturday")).toBeNull();
    expect(namedPlace("somewhere good to climb this weekend")).toBeNull();
  });

  it("never answers a named place we don't hold with a generic pick", async () => {
    const answer = await ask({
      question: "how is dogwood mcfakeface crag looking on friday",
      allowLlm: false,
      today: "2026-09-23",
    });
    expect(answer.results).toEqual([]);
    expect(answer.narrative).toMatch(/don't have/i);
  });
});
