import { describe, expect, it } from "vitest";
import { makeClassifier } from "../src/lib/sites";

const classify = makeClassifier();

describe("site classifier", () => {
  it("recognises seed publications", () => {
    expect(classify("https://newyorker.com/magazine/2009/03/30/hellhole").publication?.slug).toBe("the-new-yorker");
    expect(classify("https://magazine.atavist.com/foo").publication?.slug).toBe("the-atavist-magazine");
  });
  it("restricts shared domains to their long-form sections", () => {
    expect(classify("https://nytimes.com/2015/01/11/magazine/foo.html").publication?.slug).toBe("the-new-york-times-magazine");
    expect(classify("https://nytimes.com/magazine/foo").publication?.slug).toBe("the-new-york-times-magazine");
    expect(classify("https://nytimes.com/2015/01/11/us/politics/foo.html").preset).toBe("exclude");
    expect(classify("https://economist.com/1843/2019/01/01/x").publication?.slug).toBe("1843-magazine");
    expect(classify("https://economist.com/finance/2019/01/01/x").preset).toBe("exclude");
  });
  it("excludes platforms but not blogs hosted on them", () => {
    expect(classify("https://github.com/a/b").preset).toBe("exclude");
    expect(classify("https://en.wikipedia.org/wiki/X").preset).toBe("exclude");
    expect(classify("https://substack.com/home").preset).toBe("exclude");
    expect(classify("https://foo.substack.com/p/x").preset).toBeNull();
    expect(classify("https://medium.com/@alice/post").preset).toBeNull();
    expect(classify("https://foo.blogspot.com/2010/01/x.html").preset).toBeNull();
  });
  it("excludes curators and binary files", () => {
    expect(classify("https://longreads.com/2020/01/01/x").preset).toBe("exclude");
    expect(classify("https://example.com/paper.pdf").preset).toBe("exclude");
  });
  it("leaves unknown sites for review", () => {
    expect(classify("https://waitbutwhy.com/2015/01/x.html")).toMatchObject({ siteKey: "waitbutwhy.com", preset: null });
  });
});

describe("host-prefix and TLD rules", () => {
  it("excludes docs/jobs hosts and .gov", () => {
    expect(classify("https://docs.python.org/3/x").preset).toBe("exclude");
    expect(classify("https://jobs.lever.co/acme/1").preset).toBe("exclude");
    expect(classify("https://cdc.gov/measles/x").preset).toBe("exclude");
    expect(classify("https://www.gov.uk/guidance/x").preset).toBe("exclude");
    expect(classify("https://governing.com/a/b").preset).toBeNull();
    expect(classify("https://doctorow.example/a").preset).toBeNull();
  });
});
