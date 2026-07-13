export type Language = "en" | "hi";

const dictionary = {
  en: {
    signedIn: "Signed in",
    portal: "Portal",
    signOut: "Sign out",
    dashboard: "Dashboard",
    slabs: "Slab Entry",
    slabViewer: "Slab Viewer",
    assignVendor: "Assign Vendor",
    carving: "Vendor Work",
    approval: "Approval",
    dispatchBoard: "Dispatch",
    users: "Users",
    vendors: "Add Vendor",
    settings: "Settings",
    vendorWorkspace: "Vendor workspace",
    sharedWorkflow: "Slab to carving workflow",
    owner: "Owner",
    office: "Office",
    assigner: "Assigner",
    dispatch: "Dispatch",
    vendor: "Vendor",
    language: "Language",
    english: "English",
    hindi: "Hindi"
  },
  hi: {
    signedIn: "साइन इन",
    portal: "पोर्टल",
    signOut: "साइन आउट",
    dashboard: "डैशबोर्ड",
    slabs: "स्लैब एंट्री",
    slabViewer: "स्लैब व्यूअर",
    assignVendor: "वेंडर असाइन",
    carving: "वेंडर वर्क",
    approval: "अप्रूवल",
    dispatchBoard: "डिस्पैच",
    users: "यूज़र्स",
    vendors: "वेंडर जोड़ें",
    settings: "सेटिंग्स",
    vendorWorkspace: "वेंडर वर्कस्पेस",
    sharedWorkflow: "स्लैब से कार्विंग वर्कफ़्लो",
    owner: "ओनर",
    office: "ऑफिस",
    assigner: "असाइनर",
    dispatch: "डिस्पैच",
    vendor: "वेंडर",
    language: "भाषा",
    english: "अंग्रेज़ी",
    hindi: "हिंदी"
  }
} as const;

export function getLanguage(value: string | undefined): Language {
  return value === "hi" ? "hi" : "en";
}

export function t(lang: Language, key: keyof typeof dictionary.en) {
  return dictionary[lang][key];
}
