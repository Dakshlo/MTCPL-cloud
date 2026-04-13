export type Language = "en";

export function getLanguage(_value: string | undefined): Language {
  return "en";
}

export function t(_lang: Language, key: string): string {
  const labels: Record<string, string> = {
    signedIn: "Signed in",
    portal: "Portal",
    signOut: "Sign out",
    dashboard: "Dashboard",
    blocks: "Blocks",
    slabs: "Slabs",
    planning: "Plan Generator",
    cutting: "Cutting",
    owner: "OWNER",
    team_head: "TEAM HEAD",
    block_slab_entry: "BLOCK+SLAB ENTRY",
    slab_entry: "SLAB ENTRY",
    block_entry: "BLOCK ENTRY",
    cutting_operator: "CUTTING OPERATOR",
    carving_assigner: "Carving Assigner",
    dispatch: "Dispatch",
    vendor: "Vendor"
  };
  return labels[key] ?? key;
}
