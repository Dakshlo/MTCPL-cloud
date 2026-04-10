export type Language = "en";

export function getLanguage(_value: string | undefined): Language {
  return "en";
}

export function t(_lang: Language, key: string): string {
  const labels: Record<string, string> = {
    signedIn: "Signed in",
    signOut: "Sign out",
    dashboard: "Dashboard",
    blocks: "Blocks",
    slabs: "Slabs",
    planning: "Plan Generator",
    cutting: "Cutting",
    owner: "Owner",
    planner: "Planner",
    block_entry: "Block Entry",
    slab_entry: "Slab Entry",
    worker: "Worker",
    carving_assigner: "Carving Assigner",
    dispatch: "Dispatch",
    vendor: "Vendor"
  };
  return labels[key] ?? key;
}
