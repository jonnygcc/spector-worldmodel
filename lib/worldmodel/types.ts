// ---- State: what Spector observes on the page ----
export interface InteractiveElement {
  type: "button" | "link" | "input" | "form" | "menu";
  label: string;
  selector: string;
  coordinates: { x: number; y: number };
  // "chrome": inside header, nav or footer; "content": everything else.
  region?: "chrome" | "content";
}

export interface PageState {
  url: string;
  title: string;
  // Visible headings only, capped (page-scripts.ts). No meta description: the user doesn't see it.
  headings: string[];
  interactiveElements: InteractiveElement[];
  screenshot: string;
}
