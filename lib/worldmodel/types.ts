// ============================================================
// STATE: lo que Spector observa de la pagina
// ============================================================
export interface InteractiveElement {
  type: "button" | "link" | "input" | "form" | "menu";
  label: string;
  selector: string;
  coordinates: { x: number; y: number };
  // "chrome": dentro de header, nav o footer; "content": el resto.
  region?: "chrome" | "content";
}

export interface PageState {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  interactiveElements: InteractiveElement[];
  screenshot: string;
}
