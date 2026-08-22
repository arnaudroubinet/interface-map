import { el } from "../shared/dom";

// The page that explains the tool, inside the tool. It lives here rather than
// in a file alongside: the application is a single HTML file that gets passed
// around, and documentation that did not travel with it would never be read.
//
// It depends on no workbook: it can be consulted before one has even been
// dropped.

interface Section {
  title: string;
  paragraphes: string[];
  // A term and what it means. Half the misunderstandings come from the
  // vocabulary, not from how the thing works.
  definitions?: [string, string][];
}

const SECTIONS: Section[] = [
  {
    title: "What this tool does",
    paragraphes: [
      "It reads an Excel workbook describing an interface map and draws it. It never writes to that workbook, and nothing leaves this browser: the file is opened locally, and no page here talks to a server.",
      "Everything you see comes from the workbook. If a diagram surprises you, the answer is in a cell.",
    ],
  },
  {
    title: "The model",
    paragraphes: [
      "An interface is PROVIDED once, by one actor, and CONSUMED by one or more others. That asymmetry is the whole model: it is what lets one contract be described once and consumed twenty times.",
      "Two actors may publish interfaces of the same name; they are two interfaces, told apart by their provider.",
    ],
    definitions: [
      ["Actor", "An application, a service, a partner, a person. It belongs to a group."],
      ["Group", "Carries the perimeter — Platform or External. Actors do not carry it themselves."],
      ["Interface", "A contract: a flow name, a version, a provider, a technology."],
      ["Republication", "A technical actor's input coming back out under one of its own interfaces."],
      ["Consumption", "One actor using one interface, with its own usage, criticality and decision."],
      ["Flow type", "The technology, whether it is pushed or pulled, and optionally its colour."],
      ["Milestone", "A point on the platform's timeline. Every row says when it arrived and when it left."],
    ],
  },
  {
    title: "The two readings",
    paragraphes: [
      "The same workbook is read two ways, and you fill it in only once.",
      "These two readings match the ArchiMate viewpoints Application Cooperation and Application Usage. The tool is not inventing a concept of its own; it is offering the two an architect already works with.",
      "ARCHITECTURE answers « what does it go through »: every hop is drawn, buses and gateways included.",
      "BUSINESS answers « who feeds whom »: technical actors disappear, and the flows crossing them are joined end to end. An edge then names the exchanges it carries, since the technology is no longer there to do it.",
      "Two columns carry the distinction. Nature, on ActorTypes, says which types are technical. Republished as, on the FX_ sheets, is filled on a technical actor's own consumption lines: under which of ITS interfaces that input comes back out.",
      "It sits on the consumption because that is the line that already knows which provider and which version came in — a flow name alone never did. One value per line, so a plain drop-down guides it, offering that actor's interfaces and no others. A bus that aggregates writes nothing special: it simply has several lines pointing at the same interface. An interface that nothing feeds stops the chain, and the report says so rather than letting the link go missing.",
      "Folding a chain of flows into a single link is ArchiMate's potential derivation rule 10, and the standard warns such a derivation may be wrong. Where the chain crosses a link whose decision is Transform, the line is drawn dashed and the legend says so: it says the information travels, not that it arrives unchanged.",
      "One view has no object in business mode and disappears from the rail: « By technology », since the technology is precisely what is removed.",
    ],
  },
  {
    title: "The timeline",
    paragraphes: [
      "Pick a milestone and the whole tool answers as of that moment: diagrams, matrix, report and exports alike. A row is alive from the milestone it arrived at, up to but NOT including the one it was retired at — retired at v3 means already gone at v3.",
      "A flow is drawn only if its entire chain is alive: provider, interface, consumption, consumer.",
      "The « Changes » view compares two milestones and colours what appears and what goes.",
      "Beware of one confusion: the Remove decision is a deprecation warning, not a retirement. Only the Retired at column takes a row off the diagrams.",
    ],
  },
  {
    title: "Reading an arrow",
    paragraphes: [
      "Two things are drawn on every edge, and both follow from the flow type.",
      "The LINE follows the data: always from provider to consumer. It leaves the provider and reaches the consumer, so a chain of relays reads like a pipe rather than doubling back on itself.",
      "The ARROWHEAD says who takes the initiative. On a push — Kafka, JMS, a file drop — it sits at the far end, where the data lands. On a pull — HTTP, SQL, LDAP — it sits at the near end, pointing back at the provider being queried: the consumer is the one calling.",
      "That is why a link can show a head at the end you did not expect. Nothing is reversed: the line still says where the data goes, the head says who asked for it.",
      "The business reading keeps the line and drops the nuance, since a chain crosses technologies of opposite conventions and only the data direction survives that.",
    ],
  },
  {
    title: "The views",
    paragraphes: [
      "Each answers a different question. Switching view never changes the data, only the grain it is read at.",
    ],
    definitions: [
      ["Group to group", "The coarsest map: which groups exchange with which. Architecture only."],
      ["Platform detail", "Platform actors one by one, outside groups kept whole."],
      ["Platform only", "The platform alone, with the outside removed."],
      ["By actor", "One actor at the centre and everything it touches. Edges keep their own name."],
      ["By technology", "One technology at a time — who uses it. Architecture only."],
      ["Chain", "One exchange followed end to end through the plumbing it crosses, a link per segment, each named as it is named THERE. The question asked during an incident: where does this flow actually go?"],
      ["Roadmap", "The milestone axis as a picture: one bar per interface, from the milestone it arrives at to the one it leaves at. Overlapping versions and migrations under way become obvious."],
      ["Matrix", "The same flows as a table, readable at three grains, exportable to Excel."],
      ["Changes", "What appears and what goes between two milestones."],
      ["Integrity checks", "What the workbook gets wrong, and what it leaves unsaid."],
      ["How it works", "This page."],
    ],
  },
  {
    title: "The integrity report",
    paragraphes: [
      "Anomalies are grouped into families, and each item carries its address — sheet and row — so the workbook can be corrected without coming back here.",
      "Two scopes coexist, and the distinction matters. Structure, references, vocabularies and consistency judge the WHOLE workbook. Completeness and the informational blocks are read at the milestone on display.",
      "Informational blocks are not faults: pending decisions, migrations under way, groups in use. They describe rather than accuse.",
    ],
  },
  {
    title: "The exports",
    paragraphes: [
      "Each goes to a different destination, and each button lights up only where its export makes sense — that is why some are greyed out on some views.",
      "Structurizr and LikeC4 describe the park as a C4 model rather than a picture, so they export the architecture only. Their relationships follow the same rule as the diagrams — provider towards consumer — and since a C4 relationship has only one direction, a pulled one is tagged rather than reversed.",
    ],
    definitions: [
      ["SVG", "The diagram on screen, as a vector file that stands on its own."],
      ["PNG", "The same diagram rasterised at twice the size, for a slide or a ticket."],
      ["Excel", "The matrix as a sheet, to sort and filter it where you already do that."],
      ["Markdown", "The integrity report, ready to paste into a ticket, each line with its address."],
      ["draw.io", "Every diagram, one per tab, following the reading mode."],
      ["Structurizr", "The whole park as a Structurizr DSL model — architecture only."],
      ["LikeC4", "The same park as a LikeC4 model — architecture only."],
    ],
  },
  {
    title: "Getting started",
    paragraphes: [
      "With no workbook at hand, open the sample: it is filled in, it triggers no anomaly, and it exercises both readings.",
      "An empty template is available at the foot of the rail.",
      "An older workbook — or one missing its FX_ sheets — goes through « Repair or upgrade a workbook »: it comes back at the current format, with every expected sheet, without ever touching your original.",
    ],
  },
];

export function buildAide(): HTMLElement {
  const blocks = SECTIONS.map((s) =>
    el("section", { class: "block-info" }, [
      el("h3", {}, [s.title]),
      ...s.paragraphes.map((p) => el("p", {}, [p])),
      ...(s.definitions
        ? [
            el(
              "dl",
              { class: "help-definitions" },
              s.definitions.flatMap(([term, direction]) => [el("dt", {}, [term]), el("dd", {}, [direction])])
            ),
          ]
        : []),
    ])
  );
  return el("div", { class: "integrity-report" }, blocks);
}

// What the page documents, so that nothing new is added to the rail without a
// line here. Documentation that falls behind is worse than no documentation:
// it asserts.
export function documentedViews(): string[] {
  return termesDe("The views");
}

// The same device for the exports: an eighth format cannot arrive without its
// line here, and the test makes sure of it.
export function exportsDocumentes(): string[] {
  return termesDe("The exports");
}

function termesDe(title: string): string[] {
  return (SECTIONS.find((s) => s.title === title)?.definitions ?? []).map(([term]) => term);
}
