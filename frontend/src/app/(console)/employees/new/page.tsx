'use client';

import { useAuth } from '@/lib/auth';
import { Alert, PageHeader } from '@/components/ui';
import { EmployeeForm } from '../EmployeeForm';

export default function NewEmployeePage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Add employee" sub="Only the name and join date are required. You can fill in the rest later." crumbs={[{ href: '/employees', label: 'Employees' }]} />
      {can('employee.edit') ? <EmployeeForm /> : <Alert>You do not have permission to add employees.</Alert>}
    </>
  );
}
