export type TableColumn = {
  label: string;
  width: string;
  align: 'left' | 'center' | 'right';
};

// The borrower and lender views share the same loan shape; only the final
// column differs: borrowers get a repay/cancel Action, lenders see the
// counterparty (Borrower) they funded.
const baseColumns: readonly TableColumn[] = [
  { label: 'Loan', width: 'w-[12%]', align: 'left' },
  { label: 'Principal', width: 'w-[13%]', align: 'center' },
  { label: 'Collateral', width: 'w-[13%]', align: 'center' },
  { label: 'Interest', width: 'w-[13%]', align: 'center' },
  { label: 'Repaid', width: 'w-[14%]', align: 'center' },
  { label: 'Due', width: 'w-[16%]', align: 'center' },
  { label: 'Health Factor', width: 'w-36', align: 'center' },
  { label: 'Status', width: 'w-[11%]', align: 'center' },
];

export const getTableColumns = (role: 'borrower' | 'lender' = 'borrower'): readonly TableColumn[] => [
  ...baseColumns,
  role === 'lender'
    ? { label: 'Borrower', width: 'w-[8%]', align: 'right' }
    : { label: 'Action', width: 'w-[8%]', align: 'right' },
];

export const tableColumns = getTableColumns('borrower');
