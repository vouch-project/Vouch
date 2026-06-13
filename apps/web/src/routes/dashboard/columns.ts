export type TableColumn = {
  label: string;
  width: string;
  align: 'left' | 'center' | 'right';
};

export const tableColumns: readonly TableColumn[] = [
  { label: 'Loan', width: 'w-[13%]', align: 'left' },
  { label: 'Principal', width: 'w-[14%]', align: 'center' },
  { label: 'Interest', width: 'w-[14%]', align: 'center' },
  { label: 'Repaid', width: 'w-[15%]', align: 'center' },
  { label: 'Due', width: 'w-[22%]', align: 'center' },
  { label: 'Status', width: 'w-[12%]', align: 'center' },
  { label: 'Action', width: 'w-[10%]', align: 'right' },
];
