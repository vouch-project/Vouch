export type TableColumn = {
  label: string;
  width: string;
  align: 'left' | 'center' | 'right';
};

export const tableColumns: readonly TableColumn[] = [
  { label: 'Loan', width: 'w-[12%]', align: 'left' },
  { label: 'Principal', width: 'w-[13%]', align: 'center' },
  { label: 'Collateral', width: 'w-[13%]', align: 'center' },
  { label: 'Interest', width: 'w-[13%]', align: 'center' },
  { label: 'Repaid', width: 'w-[14%]', align: 'center' },
  { label: 'Due', width: 'w-[16%]', align: 'center' },
  { label: 'Status', width: 'w-[11%]', align: 'center' },
  { label: 'Action', width: 'w-[8%]', align: 'right' },
];
