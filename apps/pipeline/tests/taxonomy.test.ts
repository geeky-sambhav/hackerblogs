import { describe, expect, it } from "vitest";
import { taxonomyConfig } from "../src/lib/config";
import { assignAreas } from "../src/lib/taxonomy";

const areas = taxonomyConfig();
const base = { url: "https://example.com/x", title: null, dek: null, section: null, tags: [], publicationSlug: null };

describe("assignAreas", () => {
  it("uses curator tags strongly", () => {
    expect(assignAreas({ ...base, tags: ["crime"] }, areas)[0]?.slug).toBe("crime-and-justice");
  });
  it("uses URL path and title", () => {
    const r = assignAreas({ ...base, url: "https://theatlantic.com/science/archive/2015/x", title: "The Evolution of Whales" }, areas);
    expect(r[0]?.slug).toBe("science");
  });
  it("publication defaults", () => {
    expect(assignAreas({ ...base, publicationSlug: "quanta-magazine" }, areas)[0]?.slug).toBe("science");
  });
  it("falls back to miscellany", () => {
    expect(assignAreas({ ...base, title: "Untitled" }, areas)).toEqual([{ slug: "miscellany", weight: 1 }]);
  });
  it("multi-word keywords match as phrases only", () => {
    expect(assignAreas({ ...base, title: "Climate change and the coming floods", tags: ["climate change"] }, areas)[0]?.slug).toBe("nature-and-environment");
  });
});
