import { describe, expect, it } from "vitest";
import { parsePolk, parsePulitzer, quotedTitles } from "../src/stages/ingest-awards";

describe("quotedTitles", () => {
  it("extracts straight and curly quoted titles", () => {
    expect(quotedTitles(`“The Last Thing My Mother Wanted,” May 6-19`)).toEqual(["The Last Thing My Mother Wanted"]);
    expect(quotedTitles(`"Clinton and the Intern"; "The Secret War"`)).toEqual(["Clinton and the Intern", "The Secret War"]);
  });
});

describe("parsePolk", () => {
  const html = `<h5><a name="2024">2024 George Polk Award Winners</a></h5>
<p><strong>Magazine Reporting:</strong> <strong>Rachel Aviv</strong> for her <strong>New Yorker</strong> article &ldquo;Alice Munro&rsquo;s Passive Voice&rdquo;.</p>
<p><strong>Magazine Reporting</strong>: <strong>Elliott Woods</strong> of <strong>Texas Monthly</strong> for &ldquo;A Deadly Passage,&rdquo; co-published.</p>
<p><strong>Magazine Reporting: Sarah Stillman</strong> of <strong>The New Yorker</strong> for &ldquo;The Migrant Workers&rdquo;.</p>
<p><strong>Career Award:</strong> <strong>Someone</strong> for &ldquo;Lifetime&rdquo;</p>
<p><strong>Local Reporting:</strong> <strong>Staff</strong> for revealing things.</p>`;
  it("parses category, author, publication and title", () => {
    expect(parsePolk(html, "u").map((r) => [r.year, r.category, r.author, r.publication, r.title])).toEqual([
      [2024, "magazine-reporting", "Rachel Aviv", "New Yorker", "Alice Munro’s Passive Voice"],
      [2024, "magazine-reporting", "Elliott Woods", "Texas Monthly", "A Deadly Passage"],
      [2024, "magazine-reporting", "Sarah Stillman", "The New Yorker", "The Migrant Workers"],
    ]);
  });
});

describe("parsePulitzer", () => {
  const html = `<table class="wikitable"><tr><th>Year</th><th>Name(s)</th><th>Publication</th><th>Rationale</th></tr>
<tr style="background-color:lightyellow;"><th rowspan="2"><b>2025</b></th><td><b>Mark Warren</b></td><td><i><b>Esquire</b></i></td><td><b>"for a sensitive portrait"</b></td></tr>
<tr><td>Anand Gopal</td><td><i>The New Yorker</i></td><td>"for a deeply reported narrative"</td></tr></table>`;
  it("marks winners and finalists with the carried-over year", () => {
    expect(parsePulitzer(html, "feature-writing", "u").map((r) => [r.year, r.result, r.author, r.publication])).toEqual([
      [2025, "winner", "Mark Warren", "Esquire"],
      [2025, "finalist", "Anand Gopal", "The New Yorker"],
    ]);
  });
});
