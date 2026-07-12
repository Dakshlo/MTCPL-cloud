// Shared types for the Employees department (mig 189 + 193 + 194). Plain module
// so both the server pages / data loaders and the client views can import them.

export type SalaryEmployee = {
  id: string; name: string; organization: string | null; designation: string | null; fatherName: string | null; phone: string | null; aadhaar: string | null;
  bankName: string | null; accountNumber: string | null; ifsc: string | null; beneficiaryName: string | null;
  monthlySalary: number; dailySalary: number | null; salaryType: "fixed" | "variable";
  pfEnabled: boolean; uan: string | null; pfPercent: number;
  esiEnabled: boolean; esiNumber: string | null; esiPercent: number;
  tdsEnabled: boolean; tdsPercent: number;
  joinedOn: string | null; isActive: boolean; notes: string | null;
};

export type SalaryPaymentRow = {
  id: string; employeeId: string; employeeName: string; organization: string | null; designation: string | null; salaryType: "fixed" | "variable"; hasBank: boolean;
  /** Employee salary + PF/ESI settings — for the RowModal's live preview. */
  monthlySalary: number; dailySalary: number | null; pfEnabled: boolean; pfPercent: number; esiEnabled: boolean; esiPercent: number; tdsEnabled: boolean; tdsPercent: number;
  batchId: string | null;
  gross: number; pfAmount: number; esiAmount: number; tdsAmount: number; otAmount: number; otHours: number | null; advance: number; attendanceDays: number | null; remarks: string | null;
  otherDeduction: number; addition: number; net: number;
  note: string | null; status: "draft" | "paid"; paidAt: string | null;
};

export type SalaryBatch = {
  id: string; label: string; status: "draft" | "paid";
  hdfcGeneratedAt: string | null; paidAt: string | null; createdAt: string;
};

/** One PAID row (any month) — feeds the Records page (Salary paid / PF / ESI). */
export type PaidRow = { employeeId: string; month: string; net: number; pfAmount: number; esiAmount: number; paidAt: string | null };
